import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface InvitationEmailProps {
  organizationName: string;
  inviterName: string;
  role: string;
  /** Link to the accept/decline page. */
  url: string;
}

export function invitationSubject({ inviterName, organizationName }: InvitationEmailProps) {
  return `${inviterName} invited you to ${organizationName} on MeshGuard`;
}

export default function InvitationEmail({
  organizationName,
  inviterName,
  role,
  url,
}: InvitationEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Join ${organizationName} on MeshGuard`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Join {organizationName} on MeshGuard</Heading>
          <Text style={styles.text}>
            {inviterName} invited you to join <strong>{organizationName}</strong> as{" "}
            <strong>{role}</strong>.
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={url} style={styles.button}>
              View invitation
            </Button>
          </Section>
          <Text style={styles.muted}>
            Or open this link: <br />
            {url}
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.muted}>
            The invitation expires in 48 hours. If you weren&apos;t expecting it, you can ignore
            this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

InvitationEmail.PreviewProps = {
  organizationName: "Acme Labs",
  inviterName: "Jane Dev",
  role: "member",
  url: "http://localhost:3000/invitations/preview",
} satisfies InvitationEmailProps;

const styles = {
  body: {
    backgroundColor: "#f6f6f6",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  container: {
    backgroundColor: "#ffffff",
    margin: "40px auto",
    padding: "32px",
    borderRadius: "8px",
    maxWidth: "480px",
  },
  heading: { fontSize: "20px", fontWeight: 600, margin: "0 0 16px" },
  text: { fontSize: "14px", lineHeight: "22px", color: "#171717" },
  buttonSection: { margin: "24px 0" },
  button: {
    backgroundColor: "#171717",
    color: "#ffffff",
    borderRadius: "6px",
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 500,
  },
  muted: { fontSize: "12px", lineHeight: "18px", color: "#737373", wordBreak: "break-all" },
  hr: { borderColor: "#e5e5e5", margin: "24px 0" },
} as const;
