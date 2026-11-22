"use client";

/** The auth dialog's floating-label input. A "newPassword" field and its "confirmPassword" check each other. */
export function AuthField({ name, label, type = "text", autoComplete, defaultValue }: {
  name: string; label: string; type?: string; autoComplete: string; defaultValue?: string;
}) {
  return <label className="relative block min-w-0">
    <input name={name} type={type} placeholder=" " autoComplete={autoComplete} defaultValue={defaultValue} required
      {...(type === "email" ? { autoCapitalize: "none", spellCheck: false } : {})}
      minLength={name === "newPassword" ? 12 : undefined}
      maxLength={type === "password" ? 72 : 200}
      className="peer block h-12 min-h-12 w-full rounded-lg border border-input bg-white px-[11px] pt-[17px] pb-[5px] text-sm leading-5 text-foreground transition-colors outline-none focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#377db7] placeholder:text-transparent"
      onInput={event => {
        if (name === "confirmPassword" || name === "newPassword") {
          const form = event.currentTarget.form;
          const password = form?.elements.namedItem("newPassword") as HTMLInputElement | null;
          const confirmation = form?.elements.namedItem("confirmPassword") as HTMLInputElement | null;
          confirmation?.setCustomValidity(confirmation.value && confirmation.value !== password?.value ? "Şifreler eşleşmiyor." : "");
        }
      }} />
    <span className="pointer-events-none absolute top-3.5 left-3 max-w-[calc(100%-24px)] text-sm leading-5 whitespace-nowrap text-muted-foreground transition-all duration-150 peer-focus:top-1 peer-focus:text-[10px] peer-focus:leading-[14px] peer-[:not(:placeholder-shown)]:top-1 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:leading-[14px] motion-reduce:transition-none">
      {label} <em className="text-[#d72b2b] not-italic">*</em>
    </span>
  </label>;
}
