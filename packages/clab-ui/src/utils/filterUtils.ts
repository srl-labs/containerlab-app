export class FilterUtils {
  static createFilter(filterText: string) {
    if (!filterText) {
      return () => true;
    }

    const regex = this.tryCreateRegExp(filterText);
    if (regex) {
      return (value: string) => regex.test(value);
    }

    const searchText = filterText.toLowerCase();
    return (value: string) => value.toLowerCase().includes(searchText);
  }

  static tryCreateRegExp(filterText: string, flags = "i"): RegExp | null {
    if (!filterText) {
      return null;
    }

    const processedPattern = this.convertUserFriendlyPattern(filterText);

    try {
      return new RegExp(processedPattern, flags);
    } catch {
      return null;
    }
  }

  private static convertUserFriendlyPattern(pattern: string): string {
    if (this.looksLikeRegex(pattern)) {
      return pattern;
    }
    const hasWildcards = /[*?#]/.test(pattern);

    let converted = pattern
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
      .replace(/#/g, "\\d+");

    if (hasWildcards) {
      converted = `^${converted}$`;
    }

    return converted;
  }

  private static looksLikeRegex(pattern: string): boolean {
    return (
      pattern.includes("\\") ||
      pattern.includes("[") ||
      pattern.includes("(") ||
      pattern.includes("|") ||
      pattern.includes("^") ||
      pattern.includes("$") ||
      pattern.includes(".*") ||
      pattern.includes(".+")
    );
  }
}
