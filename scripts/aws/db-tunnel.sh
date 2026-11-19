#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# GetirBakim production database: local access through AWS Session Manager.
#
# Opens localhost:<port> (default 15432) to the production PostgreSQL database.
# A short-lived db-admin task is started in the private subnet with ECS Exec,
# the port is forwarded through it, and the task is stopped when the session
# ends (Ctrl-C). The task also stops itself after --hours (default 4).
#
# Connects as the read-only role getirbakim_readonly by default; its password is
# read from the macOS Keychain (service getirbakim-prod-readonly). --write uses
# the application role (the user in DATABASE_URL) and can change data.
# --psql opens psql with the password in PGPASSWORD instead of printing it;
# arguments after -- go to psql (e.g. -- -f file.sql).
#
# Requirements: AWS CLI v2, Session Manager plugin, an AWS CLI profile with
# access to the production account (221484883374); macOS Keychain for the
# read-only mode, Node.js for --write, psql for --psql.
#
# Usage:
#   bash scripts/aws/db-tunnel.sh <aws-profile> [--readonly | --write] [--psql [-- <psql args>]]
#                                 [--port 15432] [--hours 4]
#   Setup and notes: docs/aws-db-tunnel.md
# -----------------------------------------------------------------------------
set -euo pipefail

ACCOUNT_ID=221484883374
REGION=eu-central-1
STACK_PREFIX=GetirbakimProduction

# AWS_* values from the shell must not override the profile given here.
unset AWS_REGION AWS_DEFAULT_REGION AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

READONLY_USER=getirbakim_readonly
KEYCHAIN_SERVICE=getirbakim-prod-readonly
DB_NAME=getirbakim

die() { echo "ERR: $*" >&2; exit 1; }
usage() {
  echo "Usage: $0 <aws-profile> [--readonly | --write] [--psql [-- <psql args>]] [--port 15432] [--hours 4]"
  exit 64
}
[[ $# -ge 1 && "$1" != -* ]] || usage
PROFILE="$1"; shift
LOCAL_PORT=15432; HOURS=4; MODE=readonly; OPEN_PSQL=0; PSQL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) LOCAL_PORT="${2:-}"; shift ;;
    --hours) HOURS="${2:-}"; shift ;;
    --readonly) MODE=readonly ;;
    --write) MODE=write ;;
    --psql) OPEN_PSQL=1 ;;
    --) shift; PSQL_ARGS=("$@"); break ;;
    *) die "unknown flag '$1'" ;;
  esac
  shift
done
[[ "${LOCAL_PORT}" =~ ^[0-9]+$ ]] || die "--port must be a number"
[[ "${HOURS}" =~ ^[0-9]+$ && "${HOURS}" -ge 1 && "${HOURS}" -le 12 ]] || die "--hours must be 1-12"
[[ ${#PSQL_ARGS[@]} -eq 0 || ${OPEN_PSQL} -eq 1 ]] || die "arguments after -- are only used with --psql"

command -v aws >/dev/null || die "AWS CLI not installed"
command -v session-manager-plugin >/dev/null || die "Session Manager plugin not installed (brew install --cask session-manager-plugin)"
if [[ ${OPEN_PSQL} -eq 1 ]]; then
  command -v psql >/dev/null || die "psql not installed (brew install libpq)"
  command -v nc >/dev/null || die "nc not installed"
fi

# Read-only password: checked before any AWS call, so a missing item fails fast.
if [[ "${MODE}" == readonly ]]; then
  command -v security >/dev/null \
    || die "the read-only mode reads its password from the macOS Keychain ('security' not found); use --write only if you need the app user"
  DB_USER="${READONLY_USER}"
  DB_PASSWORD="$(security find-generic-password -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null)" || DB_PASSWORD=""
  [[ -n "${DB_PASSWORD}" ]] || die "no Keychain item '${KEYCHAIN_SERVICE}'. Add the ${READONLY_USER} password with:
  security add-generic-password -a ${READONLY_USER} -s ${KEYCHAIN_SERVICE} -w
(it prompts for the password; see docs/aws-db-tunnel.md)"
else
  command -v node >/dev/null || die "Node.js not installed"
  echo "WARNING: --write connects as the application user. INSERT/UPDATE/DELETE and DDL" >&2
  echo "         run on PRODUCTION. Open a transaction (BEGIN) and check before COMMIT." >&2
fi

aws() { command aws "$@" --profile "${PROFILE}" --region "${REGION}"; }

ACTIVE="$(aws sts get-caller-identity --query Account --output text)" \
  || die "profile '${PROFILE}' is not logged in"
[[ "${ACTIVE}" == "${ACCOUNT_ID}" ]] || die "profile '${PROFILE}' is in account ${ACTIVE}, expected ${ACCOUNT_ID}"

output() {
  aws cloudformation describe-stacks --stack-name "${STACK_PREFIX}-$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}
CLUSTER="$(output App ClusterName)"
FAMILY="$(output App DbAdminTaskFamily)"
CONTAINER="$(output App OperationsContainerName)"
SUBNETS="$(output Network PrivateSubnetIds)"
SG="$(output Network OperationsSecurityGroupId)"
DB_HOST="$(output Data DatabaseEndpoint)"
[[ -n "${CLUSTER}" && -n "${FAMILY}" && -n "${SUBNETS}" && -n "${SG}" && -n "${DB_HOST}" ]] \
  || die "could not read the stack outputs"
if [[ "${MODE}" == write ]]; then
  USER_SECRET="$(output Data DbAppUserSecretArn)"
  [[ -n "${USER_SECRET}" ]] || die "could not read the stack outputs"
  { IFS= read -r DB_USER && IFS= read -r DB_PASSWORD; } < <(
    aws secretsmanager get-secret-value --secret-id "${USER_SECRET}" --query SecretString --output text \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s);
          process.stdout.write(`${u.username}\n${u.password}\n`)})') || true
  [[ -n "${DB_USER:-}" && -n "${DB_PASSWORD:-}" ]] || die "could not read the application user secret"
fi

TASK_ARN="$(aws ecs run-task --cluster "${CLUSTER}" --task-definition "${FAMILY}" --launch-type FARGATE --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"${CONTAINER}\",\"command\":[\"sleep\",\"$((HOURS * 3600))\"]}]}" \
  --started-by "db-tunnel" --propagate-tags TASK_DEFINITION --enable-execute-command \
  --query 'tasks[0].taskArn' --output text)"
[[ -n "${TASK_ARN}" && "${TASK_ARN}" != "None" ]] || die "the task did not start"
TASK_ID="${TASK_ARN##*/}"

SESSION_PID=""
# The port forward runs as subshell -> aws -> session-manager-plugin; stop all of them.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "${child}"; done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  if [[ -n "${SESSION_PID}" ]]; then kill_tree "${SESSION_PID}"; fi
  echo; echo "Stopping task ${TASK_ID}"
  aws ecs stop-task --cluster "${CLUSTER}" --task "${TASK_ARN}" --reason "db-tunnel session ended" >/dev/null || true
}
trap cleanup EXIT

echo "Task ${TASK_ID} started (stops itself after ${HOURS} h), waiting for it to be ready..."
RUNTIME_ID=""
for _ in $(seq 1 60); do
  read -r STATUS AGENT RUNTIME_ID <<<"$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
    --query 'tasks[0].[lastStatus,containers[0].managedAgents[0].lastStatus,containers[0].runtimeId]' --output text)"
  [[ "${STATUS}" == "STOPPED" ]] && die "the task stopped before the tunnel opened"
  [[ "${STATUS}" == "RUNNING" && "${AGENT}" == "RUNNING" && "${RUNTIME_ID}" != "None" ]] && break
  RUNTIME_ID=""
  sleep 5
done
[[ -n "${RUNTIME_ID}" ]] || die "the task was not ready within 5 minutes"

forward() {
  aws ssm start-session --target "ecs:${CLUSTER}_${TASK_ID}_${RUNTIME_ID}" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "host=${DB_HOST},portNumber=5432,localPortNumber=${LOCAL_PORT}"
}

if [[ ${OPEN_PSQL} -eq 1 ]]; then
  forward >/dev/null &
  SESSION_PID=$!
  disown "${SESSION_PID}"
  for _ in $(seq 1 30); do
    nc -z localhost "${LOCAL_PORT}" 2>/dev/null && break
    kill -0 "${SESSION_PID}" 2>/dev/null || die "the tunnel did not open"
    sleep 1
  done
  nc -z localhost "${LOCAL_PORT}" 2>/dev/null || die "the tunnel did not open within 30 seconds"
  echo "Tunnel open, connecting as ${DB_USER}. Leaving psql closes the tunnel and stops the task."
  set +e
  PGPASSWORD="${DB_PASSWORD}" psql \
    "host=localhost port=${LOCAL_PORT} dbname=${DB_NAME} user=${DB_USER} sslmode=require" ${PSQL_ARGS[@]+"${PSQL_ARGS[@]}"}
  PSQL_STATUS=$?
  set -e
  exit "${PSQL_STATUS}"
fi

echo
if [[ "${MODE}" == readonly ]]; then
  echo "  psql \"postgresql://${DB_USER}@localhost:${LOCAL_PORT}/${DB_NAME}?sslmode=require\""
  echo "  Password: security find-generic-password -s ${KEYCHAIN_SERVICE} -w | pbcopy"
else
  PORT="${LOCAL_PORT}" U="${DB_USER}" P="${DB_PASSWORD}" DB="${DB_NAME}" node -e '
    const e=process.env;
    console.log(`  psql "postgresql://${e.U}:${encodeURIComponent(e.P)}@localhost:${e.PORT}/${e.DB}?sslmode=require"`)'
  echo "  WARNING: application user, writes reach production"
fi
echo "  Ctrl-C closes the tunnel and stops the task"
echo

forward
