import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
// Aliased: TipTap's `Image` export collides with the global `Image`
// constructor used inside resizeImage below.
import { default as TiptapImage } from "@tiptap/extension-image";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const SIGNED_URL_TTL_SECONDS = 365 * 24 * 60 * 60;
const IMAGE_MAX_WIDTH = 1200;

/**
 * TipTap-based WYSIWYG editor for wiki prose pages. Replaces the
 * markdown textarea after Jimmie's 5.4 feedback round.
 *
 * Storage: HTML (the editor's `getHTML()` output is what gets persisted
 * to wiki_pages.body). The seeded markdown pages were converted to HTML
 * in migration 20260516170000.
 *
 * Toolbar (per feedback): bold, italic, underline, headings (H1/H2/H3),
 * lists (bullet + ordered), link, image. Strikethrough + code blocks
 * omitted for v1 to keep the bar tight; easy to add when needed.
 *
 * Image upload (5.7.10): inline browser-side resize to IMAGE_MAX_WIDTH
 * via canvas, upload to private `wiki_images` Storage bucket, embed a
 * 1-year signed URL into the HTML body. Parent wires `onImageReady` to
 * track session uploads for cancel/unmount cleanup.
 */
export function WikiEditor({
  value,
  onChange,
  onImageReady,
}: {
  value: string;
  onChange: (html: string) => void;
  onImageReady?: (storagePath: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Limit StarterKit's heading levels to 1-3 (matches the wikipage
        // typography rules in src/index.css).
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      TiptapImage.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: "wikipage-img",
          loading: "lazy",
        },
      }),
    ],
    content: value || "",
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "tiptap wikipage prose",
      },
    },
  });

  // Keep editor content in sync if the parent swaps the value (e.g. page
  // switch). TipTap's setContent emits an update by default; pass
  // emitUpdate:false to avoid clobbering the parent's state during init.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="empty"><p>Loading editor...</p></div>
    );
  }

  return (
    <div className="wiki-editor">
      <Toolbar editor={editor} onImageReady={onImageReady} />
      <div className="wiki-editor-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({
  editor,
  onImageReady,
}: {
  editor: Editor;
  onImageReady?: (storagePath: string) => void;
}) {
  const promptForLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="wiki-toolbar">
      <ToolbarBtn
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <em>I</em>
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <span style={{ textDecoration: "underline" }}>U</span>
      </ToolbarBtn>
      <Sep />
      <ToolbarBtn
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        H1
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        H2
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        H3
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("paragraph") && !editor.isActive("heading")}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Paragraph"
      >
        P
      </ToolbarBtn>
      <Sep />
      <ToolbarBtn
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        •
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        1.
      </ToolbarBtn>
      <Sep />
      <ToolbarBtn
        active={editor.isActive("link")}
        onClick={promptForLink}
        title="Link"
      >
        🔗
      </ToolbarBtn>
      <ToolbarBtn
        active={false}
        onClick={() => handleImageUpload(editor, onImageReady)}
        title="Insert image"
      >
        📷
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`wiki-tbtn ${active ? "wiki-tbtn--on" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="wiki-tsep" />;
}

function handleImageUpload(
  editor: Editor,
  onImageReady?: (storagePath: string) => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const resized = await resizeImage(file, IMAGE_MAX_WIDTH);
      const safeName = file.name.replace(/[^a-z0-9.-]/gi, "_");
      const path = `${Date.now()}-${safeName}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("wiki_images")
        .upload(path, resized, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const { data: signedData, error: signErr } = await supabase.storage
        .from("wiki_images")
        .createSignedUrl(uploadData.path, SIGNED_URL_TTL_SECONDS);
      if (signErr || !signedData) throw signErr ?? new Error("signed URL failed");

      onImageReady?.(uploadData.path);
      editor.chain().focus().setImage({ src: signedData.signedUrl }).run();
    } catch (err) {
      toast({
        title: "Image upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };
  input.click();
}

async function resizeImage(file: File, maxWidth: number): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  if (img.width <= maxWidth) {
    return file;
  }

  const scale = maxWidth / img.width;
  const targetWidth = maxWidth;
  const targetHeight = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      file.type,
      0.85,
    );
  });
}
