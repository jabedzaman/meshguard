"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import { Input } from "@meshguard/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { aclMutations, aclQueries, type CheckAccessInput } from "~/lib/queries";

/**
 * Tests the policy ("may laptop reach db on TCP 5432?") and shows it as a
 * document, with names instead of ids.
 */
export function AccessCheck({
  networkId,
  devices,
}: {
  networkId: string;
  devices: { id: string; name: string }[];
}) {
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [protocol, setProtocol] = useState<CheckAccessInput["protocol"]>("tcp");
  const [port, setPort] = useState("22");
  const [showDocument, setShowDocument] = useState(false);
  const document = useQuery({ ...aclQueries.document(networkId), enabled: showDocument });
  const check = useMutation({
    mutationFn: () =>
      aclMutations.check(networkId, {
        sourceDeviceId: source,
        destinationDeviceId: destination,
        protocol,
        ...(protocol !== "icmp" && { port: Number(port) }),
      }),
  });

  if (devices.length < 2) return null;
  const name = (id: string) => devices.find((d) => d.id === id)?.name ?? "";
  const deviceSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <Select
      value={value}
      onValueChange={(id) => {
        onChange(id);
        check.reset();
      }}
    >
      <SelectTrigger className="w-40" aria-label={`Check ${label.toLowerCase()}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {devices.map((device) => (
          <SelectItem key={device.id} value={device.id}>
            {device.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <span className="font-medium">Check access</span>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          check.mutate();
        }}
      >
        {deviceSelect(source, setSource, "From")}
        <span aria-hidden>→</span>
        {deviceSelect(destination, setDestination, "To")}
        <Select
          value={protocol}
          onValueChange={(value) => {
            setProtocol(value as CheckAccessInput["protocol"]);
            check.reset();
          }}
        >
          <SelectTrigger className="w-24" aria-label="Check protocol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tcp">TCP</SelectItem>
            <SelectItem value="udp">UDP</SelectItem>
            <SelectItem value="icmp">ICMP</SelectItem>
          </SelectContent>
        </Select>
        {protocol !== "icmp" && (
          <Input
            className="w-24"
            aria-label="Check port"
            inputMode="numeric"
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              check.reset();
            }}
          />
        )}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!source || !destination || check.isPending}
        >
          Check
        </Button>
      </form>
      {check.data && (
        <p role="status" className={check.data.allowed ? "text-emerald-600" : "text-destructive"}>
          {check.data.allowed
            ? `${name(source)} may connect to ${name(destination)}${check.data.ruleIndex === null ? "" : ` (rule ${check.data.ruleIndex + 1})`}.`
            : `${name(source)} may not connect to ${name(destination)}.`}
        </p>
      )}
      {check.error && (
        <p role="alert" className="text-destructive">
          {getErrorMessage(check.error)}
        </p>
      )}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setShowDocument((show) => !show)}>
          {showDocument ? "Hide policy file" : "View as policy file"}
        </Button>
      </div>
      {showDocument && document.data && (
        <pre
          aria-label="Policy file"
          className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs"
        >
          {JSON.stringify(document.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
