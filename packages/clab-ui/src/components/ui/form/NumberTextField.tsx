// Number fields that let the user finish typing before the caller's value shows.
import React from "react";
import TextField, { type TextFieldProps } from "@mui/material/TextField";

import { useNumberDraft } from "./InputField";

/** A number `TextField` with `useNumberDraft`. */
export const NumberTextField: React.FC<Omit<TextFieldProps, "type">> = ({
  value,
  onChange,
  onBlur,
  onKeyDown,
  ...props
}) => {
  const draft = useNumberDraft(String(value ?? ""));
  return (
    <TextField
      {...props}
      type="number"
      value={draft.value}
      onChange={(event) => {
        draft.typed(event.target.value);
        onChange?.(event);
      }}
      onBlur={(event) => {
        draft.reset();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        draft.onKeyDown(event);
        onKeyDown?.(event);
      }}
    />
  );
};
