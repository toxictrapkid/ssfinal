/**
 * Mechanic-special review queue — the standing user override surface:
 * EVERY drivetrain-issue car lands here for the human to rule on, newest
 * first, regardless of what the computed math says. The math is shown to
 * inform, never to gate.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DealCard, type Listing } from "../components/DealCard";
import { DetailDrawer } from "../components/DetailDrawer";
import { EmptyState, SkeletonCard } from "../components/Primitives";

export function SpecialsView() {
  const [drawer, setDrawer] = useState<Id<"listings"> | null>(null);
  const specials = useQuery(api.listings.feed, {
    specialsOnly: true,
    sort: "newest",
  });

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <div>
        <h2 className="text-lg font-bold">🔧 Mechanic specials</h2>
        <p className="text-sm text-zinc-400">
          Every broken or doesn't-run car the scans find, newest first — you rule on each one.
          Open a card for the parts-cost math (used part median + labor).
        </p>
      </div>

      {specials === undefined && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {specials && specials.length === 0 && (
        <EmptyState
          title="No specials right now"
          body="When a scan finds a car with engine/transmission trouble or a 'doesn't run' listing, it shows up here and alerts you."
        />
      )}

      <div className="space-y-3">
        {specials?.map((listing: Listing) => (
          <DealCard key={listing._id} listing={listing} onOpen={() => setDrawer(listing._id)} />
        ))}
      </div>

      {drawer && <DetailDrawer listingId={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
