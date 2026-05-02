export const arithmetic = {
  divide(numerator: number, denominator: number): number {
    if (denominator === 0) {
      throw new Error("Cannot divide by zero");
    }
    return numerator / denominator;
  },

  add(...values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0);
  },

  subtract(left: number, right: number): number {
    return left - right;
  },

  round(value: number, places = 2): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }
};
