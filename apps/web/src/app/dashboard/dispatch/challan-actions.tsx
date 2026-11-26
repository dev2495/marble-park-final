"use client";

// Challan transport form and the cancel / failed-delivery confirmations.
// Kept beside the dispatch page so the page only wires buttons to these.

import { useEffect, useState } from "react";
import { gql, useMutation } from "@apollo/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const CANCEL_CHALLAN = gql`
  mutation CancelChallan($id: ID!, $reason: String!) {
    cancelChallan(id: $id, reason: $reason)
  }
`;
export const REPORT_FAILED_DELIVERY = gql`
  mutation ReportFailedDelivery($id: ID!, $reason: String!) {
    reportFailedDelivery(id: $id, reason: $reason)
  }
`;
export const UPDATE_CHALLAN_TRANSPORT = gql`
  mutation UpdateChallanTransport($id: ID!, $input: ChallanTransportUpdateInput!) {
    updateChallanTransport(id: $id, input: $input)
  }
`;

export type TransportValues = {
  transportMode: "vehicle" | "self_pickup";
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  transporter: string;
  notes: string;
};

const PLACEHOLDER = { vehicleNumber: "PENDING", driverName: "Dispatch desk", transporterName: "Store vehicle" };

/** Old challans were made with stand-in values before this form existed. */
export function isPlaceholderTransport(challan: any) {
  return !challan?.transportMode && (challan?.vehicleNumber === PLACEHOLDER.vehicleNumber || challan?.driverName === PLACEHOLDER.driverName);
}

/** One line for the challan row: real details, "Customer pickup", or "Transport not entered". */
export function transportSummary(challan: any) {
  if (challan?.transportMode === "self_pickup") return `Customer pickup${challan.driverName ? ` · ${challan.driverName}` : ""}`;
  if (isPlaceholderTransport(challan) || !challan?.vehicleNumber) return "Transport not entered";
  return [challan.vehicleNumber, challan.driverName, challan.contactPhone, challan.transporterName].filter(Boolean).join(" · ");
}

export function transportFromChallan(challan: any): TransportValues {
  const placeholder = isPlaceholderTransport(challan);
  return {
    transportMode: challan?.transportMode === "self_pickup" ? "self_pickup" : "vehicle",
    vehicleNo: placeholder ? "" : challan?.vehicleNumber || "",
    driverName: placeholder ? "" : challan?.driverName || "",
    driverPhone: placeholder || challan?.contactPhone === "0000000000" ? "" : challan?.contactPhone || "",
    transporter: placeholder ? "" : challan?.transporterName || "",
    notes: "",
  };
}

export const emptyTransport: TransportValues = { transportMode: "vehicle", vehicleNo: "", driverName: "", driverPhone: "", transporter: "", notes: "" };

function transportErrors(values: TransportValues) {
  const errors: Partial<Record<keyof TransportValues, string>> = {};
  if (values.transportMode === "self_pickup") return errors;
  const vehicle = values.vehicleNo.trim().toUpperCase();
  if (!vehicle) errors.vehicleNo = "Enter the vehicle number";
  else if (!/^[A-Z0-9][A-Z0-9 -]{3,19}$/.test(vehicle)) errors.vehicleNo = "Letters, numbers, spaces and dashes only";
  if (values.driverName.trim().length < 2) errors.driverName = "Enter the driver's name";
  const digits = values.driverPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13 || /^0+$/.test(digits)) errors.driverPhone = "Enter a 10 digit phone number";
  return errors;
}

/**
 * Transport details for a new challan, or to correct one before it leaves.
 * onSubmit gets the cleaned values; close the dialog yourself when it succeeds.
 */
export function TransportDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  initial,
  busy,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  initial?: TransportValues;
  busy?: boolean;
  onSubmit: (values: TransportValues) => void | Promise<unknown>;
  children?: React.ReactNode;
}) {
  const [values, setValues] = useState<TransportValues>(initial || emptyTransport);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setValues(initial || emptyTransport);
      setTouched(false);
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = transportErrors(values);
  const invalid = Object.keys(errors).length > 0;
  const set = (patch: Partial<TransportValues>) => setValues((current) => ({ ...current, ...patch }));
  const pickup = values.transportMode === "self_pickup";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={pickup ? "The customer collects the goods. No vehicle details are needed." : "These details print on the dispatch slip. You can correct them until the challan is dispatched."}
      confirmLabel={confirmLabel}
      busy={busy}
      onConfirm={() => {
        setTouched(true);
        if (invalid) return;
        return onSubmit({ ...values, vehicleNo: values.vehicleNo.trim().toUpperCase(), driverName: values.driverName.trim(), driverPhone: values.driverPhone.trim(), transporter: values.transporter.trim(), notes: values.notes.trim() });
      }}
    >
      <fieldset className="flex flex-wrap gap-4 text-sm font-semibold text-[var(--ink)]">
        <legend className="sr-only">How the goods go</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="transportMode" checked={!pickup} onChange={() => set({ transportMode: "vehicle" })} />
          Our or a hired vehicle
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="transportMode" checked={pickup} onChange={() => set({ transportMode: "self_pickup" })} />
          Customer pickup
        </label>
      </fieldset>
      {!pickup ? (
        <>
          <Field label="Vehicle number" required error={touched ? errors.vehicleNo : undefined}>
            <Input value={values.vehicleNo} maxLength={20} placeholder="GJ 01 AB 1234" onChange={(event) => set({ vehicleNo: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Driver name" required error={touched ? errors.driverName : undefined}>
              <Input value={values.driverName} maxLength={80} onChange={(event) => set({ driverName: event.target.value })} />
            </Field>
            <Field label="Driver phone" required error={touched ? errors.driverPhone : undefined}>
              <Input value={values.driverPhone} maxLength={24} inputMode="tel" onChange={(event) => set({ driverPhone: event.target.value })} />
            </Field>
          </div>
          <Field label="Transporter" hint="Leave empty for our own vehicle">
            <Input value={values.transporter} maxLength={80} onChange={(event) => set({ transporter: event.target.value })} />
          </Field>
        </>
      ) : (
        <Field label="Collected by" hint="Optional: who is collecting">
          <Input value={values.driverName} maxLength={80} onChange={(event) => set({ driverName: event.target.value })} />
        </Field>
      )}
      <Field label="Notes" hint="Optional, prints on the slip">
        <Input value={values.notes} maxLength={500} onChange={(event) => set({ notes: event.target.value })} />
      </Field>
      {children}
    </ConfirmDialog>
  );
}

/** Asks for a reason, then runs one challan action (cancel or failed delivery). */
export function ChallanReasonDialog({
  challan,
  kind,
  onClose,
  onDone,
}: {
  challan: any | null;
  kind: "cancel" | "failed";
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [cancelChallan, cancelState] = useMutation(CANCEL_CHALLAN);
  const [reportFailed, failedState] = useMutation(REPORT_FAILED_DELIVERY);
  const busy = cancelState.loading || failedState.loading;
  const error = cancelState.error || failedState.error;
  useEffect(() => { if (challan) setReason(""); }, [challan]);
  const backFromRoad = challan?.status === "failed_delivery";
  const title = kind === "failed"
    ? `Delivery failed for ${challan?.challanNumber || "this challan"}?`
    : `Cancel ${challan?.challanNumber || "this challan"}?`;
  const description = kind === "failed"
    ? "The challan stays open. Send it again later, or cancel it once the goods are back in the store."
    : backFromRoad
      ? "Use this when the goods are back in the store. They go back into stock, held again for this order, and can be picked again."
      : "Nothing has left the store. The items go back to the pick so a new challan can be made.";
  return (
    <ConfirmDialog
      open={Boolean(challan)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      description={description}
      confirmLabel={kind === "failed" ? "Mark delivery failed" : backFromRoad ? "Cancel and take stock back" : "Cancel challan"}
      tone="danger"
      busy={busy}
      confirmDisabled={reason.trim().length < 5}
      onConfirm={async () => {
        const variables = { id: challan.id, reason: reason.trim() };
        try {
          if (kind === "failed") await reportFailed({ variables });
          else await cancelChallan({ variables });
          onDone();
          onClose();
        } catch {
          // The error is shown in the dialog below.
        }
      }}
    >
      <Field label="Reason" required hint="At least 5 characters" error={error ? error.message : undefined}>
        <Input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}
