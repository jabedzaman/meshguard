import { createLogger } from "@meshguard/utils";
import nodemailer from "nodemailer";

const logger = createLogger("mailer");

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailerOptions {
  /** e.g. smtp://mailpit:1025 in development, smtps://user:pass@host:465 in production. */
  smtpUrl: string;
  /** e.g. "MeshGuard <no-reply@example.com>" */
  from: string;
}

export function createMailer({ smtpUrl, from }: MailerOptions) {
  const transport = nodemailer.createTransport(smtpUrl);

  return {
    async send(email: Email) {
      const info = await transport.sendMail({ from, ...email });
      logger.info(
        { to: email.to, subject: email.subject, messageId: info.messageId },
        "email sent",
      );
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
