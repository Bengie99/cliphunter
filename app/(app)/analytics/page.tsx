import { PlannedPage } from "@/components/layout/planned-page";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <PlannedPage
      title="Analytics"
      phase={3}
      summary="Trends across your clip library and production output. Discovery-per-day and platform breakdowns are already on the Dashboard."
      features={[
        "Clips discovered per day & per platform",
        "Average viral score over time",
        "Approval and rejection rates",
        "Download success rate",
        "Clips published and their performance",
        "Date ranges: 24h, 7d, 30d, 90d, custom",
      ]}
    />
  );
}
