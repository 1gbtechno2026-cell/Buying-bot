export class CardDeclinedError extends Error {
  readonly cardLast4: string;
  readonly reason: string;
  constructor(cardLast4: string, reason: string) {
    super(`Card ending ${cardLast4} declined: ${reason}`);
    this.name = "CardDeclinedError";
    this.cardLast4 = cardLast4;
    this.reason = reason;
  }
}
