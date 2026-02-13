import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground text-center">
        This URL does not exist. The app home is the token analysis form.
      </p>
      <Button asChild>
        <Link href="/">Go to home</Link>
      </Button>
    </div>
  );
}
