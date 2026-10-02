"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type Role } from "@mesh/auth/permissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mesh/ui/components/select";
import {
  useCurrentUser,
  useOrganization,
  usePermission,
  useRole,
} from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";
import { memberQueries } from "~/lib/queries";

export function MembersList() {
  const organization = useOrganization();
  const currentUser = useCurrentUser();
  const myRole = useRole();
  const canUpdateRoles = usePermission({ member: ["update"] });
  const queryClient = useQueryClient();
  const { data: members, isPending, error } = useQuery(memberQueries.list(organization.id));

  // Mirrors Better Auth's rules: only owners change owners or grant owner.
  const assignableRoles: Role[] = myRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      unwrap(authClient.organization.updateMemberRole({ memberId, role })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: memberQueries.all() }),
  });

  if (isPending) return <p className="text-muted-foreground text-sm">Loading members…</p>;
  if (error) return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="flex flex-col gap-2">
      {updateRole.error && (
        <p role="alert" className="text-destructive text-sm">
          {updateRole.error.message}
        </p>
      )}
      <ul className="divide-border divide-y rounded-md border">
        {members.map((member) => {
          const isSelf = member.userId === currentUser.id;
          const editable =
            canUpdateRoles && !isSelf && (member.role !== "owner" || myRole === "owner");
          return (
            <li key={member.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div className="grid">
                <span className="font-medium">
                  {member.user.name}
                  {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                </span>
                <span className="text-muted-foreground text-xs">{member.user.email}</span>
              </div>
              {editable ? (
                <Select
                  value={member.role}
                  disabled={updateRole.isPending && updateRole.variables?.memberId === member.id}
                  onValueChange={(role) =>
                    updateRole.mutate({ memberId: member.id, role: role as Role })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28"
                    aria-label={`Role for ${member.user.email}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-muted-foreground w-28 px-3 text-sm">{member.role}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
