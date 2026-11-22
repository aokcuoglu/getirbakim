/** The reset request and new-password forms' result (#1257). */
export type ResetState = {
  status: "idle" | "sent" | "error";
  message: string;
  attempt: number;
  /** The typed address, echoed after a refusal of the request form. */
  email?: string;
};
export const initialResetState: ResetState = { status: "idle", message: "", attempt: 0 };
