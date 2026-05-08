import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  // Phase 3.7.8: toasts adopt Mirror coral by default. Title and body
  // both render in white (description gets a slight opacity to keep the
  // hierarchy without going grey, since grey-on-coral reads poorly).
  // Action / cancel buttons stay neutral (white-on-transparent) so they
  // read as inline controls rather than competing with the toast color.
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-primary group-[.toaster]:text-primary-foreground group-[.toaster]:border-primary group-[.toaster]:shadow-lg",
          title: "group-[.toast]:text-primary-foreground group-[.toast]:font-bold",
          description: "group-[.toast]:text-primary-foreground/90",
          actionButton: "group-[.toast]:bg-primary-foreground group-[.toast]:text-primary",
          cancelButton: "group-[.toast]:bg-transparent group-[.toast]:text-primary-foreground/80 group-[.toast]:border group-[.toast]:border-primary-foreground/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
