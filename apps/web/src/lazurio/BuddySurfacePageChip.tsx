/**
 * Lazurio overlay (root decision 0210, plan DEV-6676): the chip of the page Buddy is asked from
 * (buddySurfacePage.ts). Above Buddy's composer it shows the page the next message will carry, with
 * a button that leaves it out; in the person's sent messages it stands where their text refers to
 * the page, where T3 would otherwise call it unavailable context.
 */
import { MapPinIcon, XIcon } from "lucide-react";
import type { ReactElement } from "react";

import { ContextChip, ContextChipAction, ContextChipLabel } from "~/components/ContextChip";
import { LAZURIO_PAGE_KIND } from "./buddySurfacePage";

/** A page reference's chip in a message; none for any other kind. */
export function buddyPageReferenceChip(
  kind: string,
  label: string,
  copyMarkdown?: string,
): ReactElement | undefined {
  return kind === LAZURIO_PAGE_KIND ? (
    <ContextChip data-markdown-copy={copyMarkdown}>
      <MapPinIcon aria-hidden />
      <ContextChipLabel>{label}</ContextChipLabel>
    </ContextChip>
  ) : undefined;
}

export function BuddyPageChip(props: {
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 px-3 pt-2" data-lazurio-buddy-page>
      <ContextChip>
        <MapPinIcon aria-hidden />
        <ContextChipLabel>{props.label}</ContextChipLabel>
        <ContextChipAction aria-label={props.removeLabel} onClick={props.onRemove}>
          <XIcon />
        </ContextChipAction>
      </ContextChip>
    </div>
  );
}
