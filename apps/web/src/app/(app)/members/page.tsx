import type { Metadata } from "next";
import { InviteMemberForm } from "~/components/invite-member-form";
import { LeaveOrganization } from "~/components/leave-organization";
import { MembersList } from "~/components/members-list";
import { PageHeader } from "~/components/page-header";
import { PendingInvitations } from "~/components/pending-invitations";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Members"
        description="People in this organization and what their role lets them do."
      />
      <section className="flex flex-col gap-3">
        <MembersList />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Invite people</h2>
        <InviteMemberForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Pending invitations</h2>
        <PendingInvitations />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-destructive text-sm font-medium">Danger zone</h2>
        <LeaveOrganization />
      </section>
    </div>
  );
}
