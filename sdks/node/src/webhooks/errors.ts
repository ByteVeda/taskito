import { TaskitoError } from "../errors";

/** Thrown when a webhook definition fails validation. Dashboard maps it to 400. */
export class WebhookValidationError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}
