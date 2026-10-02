import type { Metadata } from "next";
import { InviteMemberForm } from "~/components/invite-member-form";
import { MembersList } from "~/components/members-list";
import { PendingInvitations } from "~/components/pending-invitations";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="font-medium">Members</h2>
        <MembersList />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-medium">Invite people</h2>
        <InviteMemberForm />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-medium">Pending invitations</h2>
        <PendingInvitations />
      </section>
    </div>
  );
}
