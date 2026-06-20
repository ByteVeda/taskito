/** Thrown when a webhook definition fails validation. Dashboard maps it to 400. */
export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}
