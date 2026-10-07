export function confirmationCharacter(event) {
  const { isTrusted, inputType, isComposing, data } = event;
  return isTrusted && inputType === "insertText" && !isComposing &&
    typeof data === "string" && data.length === 1 && /^[a-z0-9]$/i.test(data)
    ? data.toUpperCase()
    : "";
}
