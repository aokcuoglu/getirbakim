#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# GetirBakim production database: local access through AWS Session Manager.
#
# Opens localhost:<port> (default 15432) to the production PostgreSQL database.
# A short-lived db-admin task is started in the private subnet with ECS Exec,
# the port is forwarded through it, and the task is stopped when the session
# ends (Ctrl-C). The task also stops itself after --hours (default 4).
#
# Connects as the application role (the user in DATABASE_URL).
#
# Requirements: AWS CLI v2, Session Manager plugin, Node.js, and an AWS CLI
# profile with access to the production account (221484883374).
#
# Usage:
#   bash scripts/aws/db-tunnel.sh <aws-profile> [--port 15432] [--hours 4]
#   Setup and notes: docs/aws-db-tunnel.md
# -----------------------------------------------------------------------------
set -euo pipefail

ACCOUNT_ID=221484883374
REGION=eu-central-1
STACK_PREFIX=GetirbakimProduction

# AWS_* values from the shell must not override the profile given here.
unset AWS_REGION AWS_DEFAULT_REGION AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

die() { echo "ERR: $*" >&2; exit 1; }
[[ $# -ge 1 && "$1" != --* ]] || { echo "Usage: $0 <aws-profile> [--port 15432] [--hours 4]"; exit 64; }
PROFILE="$1"; shift
LOCAL_PORT=15432; HOURS=4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) LOCAL_PORT="${2:-}"; shift ;;
    --hours) HOURS="${2:-}"; shift ;;
    *) die "unknown flag '$1'" ;;
  esac
  shift
done
[[ "${LOCAL_PORT}" =~ ^[0-9]+$ ]] || die "--port must be a number"
[[ "${HOURS}" =~ ^[0-9]+$ && "${HOURS}" -ge 1 && "${HOURS}" -le 12 ]] || die "--hours must be 1-12"

command -v aws >/dev/null || die "AWS CLI not installed"
command -v session-manager-plugin >/dev/null || die "Session Manager plugin not installed (brew install --cask session-manager-plugin)"
command -v node >/dev/null || die "Node.js not installed"

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
USER_SECRET="$(output Data DbAppUserSecretArn)"
[[ -n "${CLUSTER}" && -n "${FAMILY}" && -n "${SUBNETS}" && -n "${SG}" && -n "${DB_HOST}" && -n "${USER_SECRET}" ]] \
  || die "could not read the stack outputs"

TASK_ARN="$(aws ecs run-task --cluster "${CLUSTER}" --task-definition "${FAMILY}" --launch-type FARGATE --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"${CONTAINER}\",\"command\":[\"sleep\",\"$((HOURS * 3600))\"]}]}" \
  --started-by "db-tunnel" --propagate-tags TASK_DEFINITION --enable-execute-command \
  --query 'tasks[0].taskArn' --output text)"
[[ -n "${TASK_ARN}" && "${TASK_ARN}" != "None" ]] || die "the task did not start"
TASK_ID="${TASK_ARN##*/}"

cleanup() {
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

echo
aws secretsmanager get-secret-value --secret-id "${USER_SECRET}" --query SecretString --output text \
  | PORT="${LOCAL_PORT}" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s);
      console.log(`  psql "postgresql://${u.username}:${encodeURIComponent(u.password)}@localhost:${process.env.PORT}/getirbakim?sslmode=require"`)})'
echo "  Ctrl-C closes the tunnel and stops the task"
echo

aws ssm start-session --target "ecs:${CLUSTER}_${TASK_ID}_${RUNTIME_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=${DB_HOST},portNumber=5432,localPortNumber=${LOCAL_PORT}"
