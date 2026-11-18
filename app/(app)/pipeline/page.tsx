import { PipelineSummary, SectionCard } from "@/components/dashboard/widgets";
import { PlannedPage } from "@/components/layout/planned-page";
import { getRepository } from "@/lib/data";

export const metadata = { title: "Content Pipeline" };

export default async function PipelinePage() {
  const stats = await getRepository().getDashboardStats();
  return (
    <PlannedPage
      title="Content Pipeline"
      phase={5}
      summary="A Kanban board to move clips from discovery to publication. Stage changes are already recorded in the database (clip_pipeline_history); approving a clip moves it to “Approved”."
      features={[
        "Drag-and-drop Kanban across 10 stages",
        "Editing notes, proposed YouTube title & description",
        "Hashtags and target publishing date",
        "Published video URL and publishing history",
      ]}
    >
      <SectionCard title="Current stage counts (live)">
        <PipelineSummary byPipeline={stats.byPipeline} />
      </SectionCard>
    </PlannedPage>
  );
}
