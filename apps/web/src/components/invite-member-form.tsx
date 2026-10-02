"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@mesh/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@mesh/ui/components/form";
import { Input } from "@mesh/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mesh/ui/components/select";
import { usePermission } from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";
import { invitationQueries } from "~/lib/queries";

// Owners are made through role assignment, not invited directly.
const INVITABLE_ROLES = ["member", "admin"] as const;

const schema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(INVITABLE_ROLES),
});

type Values = z.infer<typeof schema>;

export function InviteMemberForm() {
  const canInvite = usePermission({ invitation: ["create"] });
  if (!canInvite) return null;
  return <InviteMemberFormInner />;
}

function InviteMemberFormInner() {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "member" },
  });

  const invite = useMutation({
    mutationFn: (values: Values) => unwrap(authClient.organization.inviteMember(values)),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: invitationQueries.all() });
    },
    // Better Auth's messages ("User is already invited…") are user-facing.
    onError: (error) => form.setError("email", { message: error.message }),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => invite.mutate(values))}
        className="flex flex-col gap-4 rounded-md border p-4 sm:flex-row sm:items-start"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="teammate@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem className="sm:w-36">
              <FormLabel>Role</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="sm:mt-[22px]" disabled={invite.isPending}>
          {invite.isPending ? "Sending…" : "Send invite"}
        </Button>
      </form>
    </Form>
  );
}
