export type SignupState = { status: "idle" | "error"; message: string };
export const initialSignupState: SignupState = { status: "idle", message: "" };
