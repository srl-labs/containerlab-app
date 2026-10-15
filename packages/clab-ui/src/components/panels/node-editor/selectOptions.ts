// Select option helpers for the node editor.

export interface NodeEditorSelectOption {
  value: string;
  label: string;
}

/**
 * Add the current value as an option when the list does not offer it, so a
 * value written by hand still shows in the select instead of a blank field.
 */
export function withCurrentOption(
  options: NodeEditorSelectOption[],
  value: string
): NodeEditorSelectOption[] {
  if (value === "" || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}
