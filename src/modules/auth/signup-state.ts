/** The signup form's result; `values` echoes the typed name, email and consent (never the passwords) after a refusal. */
export type SignupState = {
  status: "idle" | "error";
  message: string;
  attempt: number;
  values?: { name: string; email: string; terms: boolean };
};
export const initialSignupState: SignupState = { status: "idle", message: "", attempt: 0 };
