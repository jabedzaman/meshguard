import type { Metadata } from "next";
import { CreateOrganization } from "~/components/create-organization";

export const metadata: Metadata = { title: "Create organization" };

export default function CreateOrganizationPage() {
  return <CreateOrganization />;
}
