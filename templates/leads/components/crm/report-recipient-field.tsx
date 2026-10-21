"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { isEmailAddress } from "@/lib/crm/email-address";
import {
  reportRecipientOptions,
  resolveReportRecipient,
  type ReportRecipientSelection,
} from "@/lib/crm/email-preferences";
import type { Settings, ReportRecipientKind } from "@/lib/crm/types";
import { Field, NativeSelect } from "./shared";

type Props = {
  settings: Settings;
  senderEmail: string;
  value: ReportRecipientSelection;
  onChange: (value: ReportRecipientSelection) => void;
  label?: string;
  disabled?: boolean;
};

export function ReportRecipientField({
  settings,
  senderEmail,
  value,
  onChange,
  label = "Send to",
  disabled = false,
}: Props) {
  const id = useId();
  const address = resolveReportRecipient(settings, senderEmail, value);
  const options = reportRecipientOptions(settings, senderEmail);

  return (
    <div className="space-y-4">
      <Field label={label}>
        <NativeSelect
          id={`${id}-recipient`}
          value={value.kind}
          onChange={(event) =>
            onChange({ ...value, kind: event.target.value as ReportRecipientKind })
          }
          disabled={disabled}
          className="w-full"
        >
          {options.map((option) => (
            <option
              key={option.kind}
              value={option.kind}
              disabled={option.kind !== "custom" && !isEmailAddress(option.email)}
            >
              {option.label}
              {option.email ? ` · ${option.email}` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {value.kind === "custom" && (
        <Field label="Custom report email">
          <Input
            id={`${id}-address`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={value.address}
            onChange={(event) => onChange({ ...value, address: event.target.value })}
            placeholder="reports@yourbusiness.com"
            maxLength={254}
            required
            disabled={disabled}
          />
        </Field>
      )}
      <p className="break-words text-xs leading-6 text-muted-foreground">
        {isEmailAddress(address) ? (
          <>
            Reports will be delivered to{" "}
            <strong className="break-all text-foreground">{address}</strong>.
          </>
        ) : (
          "Choose an available account or enter a valid email address."
        )}
      </p>
    </div>
  );
}
