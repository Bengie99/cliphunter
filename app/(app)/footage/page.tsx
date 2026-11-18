import { PlannedPage } from "@/components/layout/planned-page";

export const metadata = { title: "Downloaded Footage" };

export default function FootagePage() {
  return (
    <PlannedPage
      title="Downloaded Footage"
      phase={4}
      summary="Manage source footage you're authorized to use. Downloads are only ever enabled for clips with an authorized source — discovery alone never grants that permission."
      features={[
        "Authorized downloads (e.g. official Twitch clip download where permitted)",
        "Manual upload of your own / licensed video files",
        "FFmpeg metadata extraction (duration, resolution, codec)",
        "Duplicate file detection by checksum",
        "Status tracking: Not available → Downloaded / Failed",
        "Preview player with access to the original file",
      ]}
    />
  );
}
