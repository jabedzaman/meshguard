import { render } from "@react-email/components";
import InvitationEmail, {
  type InvitationEmailProps,
  invitationSubject,
} from "~/templates/invitation";

/** Every email the app sends, keyed by template name. */
const templates = {
  invitation: { component: InvitationEmail, subject: invitationSubject },
} satisfies Record<
  string,
  { component: (props: never) => React.ReactNode; subject: (props: never) => string }
>;

export type EmailTemplate = keyof typeof templates;

export interface EmailTemplateProps {
  invitation: InvitationEmailProps;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail<T extends EmailTemplate>(
  template: T,
  props: EmailTemplateProps[T],
): Promise<RenderedEmail> {
  const { component: Component, subject } = templates[template];
  const element = <Component {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: subject(props), html, text };
}

export type { InvitationEmailProps };
