"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ROLES, type Role } from "@meshguard/auth/permissions";
import { Avatar, AvatarFallback } from "@meshguard/ui/components/avatar";
import { Badge } from "@meshguard/ui/components/badge";
import { Button } from "@meshguard/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
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
  const canRemove = usePermission({ member: ["delete"] });
  const queryClient = useQueryClient();
  const { data: members, isPending, error } = useQuery(memberQueries.list(organization.id));

  // Mirrors Better Auth's rules: only owners change owners or grant owner.
  const assignableRoles: Role[] = myRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      unwrap(authClient.organization.updateMemberRole({ memberId, role })),
    onSuccess: () => toast.success("Role changed"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: memberQueries.all() }),
  });

  if (isPending) return <ListSkeleton label="Loading members" />;
  if (error) return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="flex flex-col gap-2">
      {updateRole.error && (
        <p role="alert" className="text-destructive text-sm">
          {updateRole.error.message}
        </p>
      )}
      <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
        {members.map((member) => {
          const isSelf = member.userId === currentUser.id;
          // Only owners can act on owners; nobody acts on themselves here
          // (leaving is a separate action).
          const canActOn = !isSelf && (member.role !== "owner" || myRole === "owner");
          const editable = canUpdateRoles && canActOn;
          const removable = canRemove && canActOn;
          return (
            <li key={member.id} className="flex items-center justify-between gap-4 p-4 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-9">
                  <AvatarFallback className="uppercase">{member.user.name[0]}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0">
                  <span className="truncate font-medium">
                    {member.user.name}
                    {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {member.user.email}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                  <span className="w-28 px-3">
                    <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                      {member.role}
                    </Badge>
                  </span>
                )}
                {removable ? (
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:text-destructive"
                        aria-label={`Remove ${member.user.email}`}
                      >
                        <Trash2Icon />
                      </Button>
                    }
                    triggerTooltip="Remove"
                    title={`Remove ${member.user.name}?`}
                    description={`${member.user.email} will lose access to ${organization.name}.`}
                    confirmLabel="Remove member"
                    onConfirm={async () => {
                      await unwrap(
                        authClient.organization.removeMember({ memberIdOrEmail: member.id }),
                      );
                      toast.success("Member removed");
                      await queryClient.invalidateQueries({ queryKey: memberQueries.all() });
                    }}
                  />
                ) : (
                  // Keeps role columns aligned across rows.
                  canRemove && <span className="w-8" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
