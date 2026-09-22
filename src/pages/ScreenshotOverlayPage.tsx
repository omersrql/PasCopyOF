import React, { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  copyAnnotatedImage,
  saveAnnotatedImage,
  hideScreenshotOverlay,
  extractTextFromImage,
} from "../api/screenshot";
import { useApp } from "../context/AppContext";

type ToolType = "crop" | "pen" | "highlighter" | "arrow" | "rect" | "text" | "blur" | "step";

interface RectSelection {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface BaseAnnotation {
  id: string;
  type: ToolType;
}

interface PenAnnotation extends BaseAnnotation {
  type: "pen" | "highlighter";
  points: Point[];
  color: string;
  strokeWidth: number;
}

interface ArrowAnnotation extends BaseAnnotation {
  type: "arrow";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  strokeWidth: number;
}

interface RectAnnotation extends BaseAnnotation {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
}

interface TextAnnotation extends BaseAnnotation {
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

interface BlurAnnotation extends BaseAnnotation {
  type: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StepAnnotation extends BaseAnnotation {
  type: "step";
  x: number;
  y: number;
  stepNumber: number;
  color: string;
}

type Annotation =
  | PenAnnotation
  | ArrowAnnotation
  | RectAnnotation
  | TextAnnotation
  | BlurAnnotation
  | StepAnnotation;

const PALETTE = [
  "#ef4444", // Red
  "#3b82f6", // Blue
  "#10b981", // Green
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ffffff", // White
  "#0f172a", // Dark
];

const STROKE_WIDTHS = [2, 4, 8];

const getSelectionHandles = (sel: RectSelection) => {
  return {
    nw: { x: sel.x, y: sel.y },
    n: { x: sel.x + sel.w / 2, y: sel.y },
    ne: { x: sel.x + sel.w, y: sel.y },
    e: { x: sel.x + sel.w, y: sel.y + sel.h / 2 },
    se: { x: sel.x + sel.w, y: sel.y + sel.h },
    s: { x: sel.x + sel.w / 2, y: sel.y + sel.h },
    sw: { x: sel.x, y: sel.y + sel.h },
    w: { x: sel.x, y: sel.y + sel.h / 2 },
  };
};

export default function ScreenshotOverlayPage() {
  const { t } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [selection, setSelection] = useState<RectSelection | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>("crop");
  const [color, setColor] = useState<string>("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [stepCounter, setStepCounter] = useState<number>(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeDrag, setActiveDrag] = useState<any>(null);
  const [hoverHandle, setHoverHandle] = useState<string | null>(null);

  const [textInput, setTextInput] = useState<{ x: number; y: number; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef(textInput);
  textInputRef.current = textInput;

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrResultText, setOcrResultText] = useState<string | null>(null);
  const [mockupMode, setMockupMode] = useState<boolean>(false);
  const [showMagnifier, setShowMagnifier] = useState<boolean>(true); // Default open
  const [mousePos, setMousePos] = useState<{
    canvasX: number;
    canvasY: number;
    clientX: number;
    clientY: number;
    hex: string;
  } | null>(null);

  useEffect(() => {
    if (textInput) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
    }
  }, [textInput?.x, textInput?.y]);

  const showOverlayToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Listen for backend screenshot capture event
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    listen<{ image: string; width: number; height: number }>("screenshot-captured", (event) => {
      const { image, width, height } = event.payload;
      setScreenshotSrc(image);
      setImgSize({ w: width, h: height });

      const img = new Image();
      img.onload = () => {
        imageObjRef.current = img;
        setSelection(null);
        setAnnotations([]);
        setStepCounter(1);
        setTextInput(null);
        setActiveTool("crop");
        setMockupMode(false);
        setShowMagnifier(true);
        setOcrResultText(null);
      };
      img.src = image;
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const hitTestHandles = (x: number, y: number, sel: RectSelection): string | null => {
    const handles = getSelectionHandles(sel);
    const tolerance = 9;
    for (const [key, pt] of Object.entries(handles)) {
      if (Math.hypot(x - pt.x, y - pt.y) <= tolerance) {
        return key;
      }
    }
    if (x >= sel.x && x <= sel.x + sel.w && y >= sel.y && y <= sel.y + sel.h) {
      return "move";
    }
    return null;
  };

  // Magnifier updater
  const updateMagnifier = (canvasX: number, canvasY: number, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img || imgSize.w === 0 || imgSize.h === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ix = Math.floor(Math.max(0, Math.min(imgSize.w - 1, canvasX)));
    const iy = Math.floor(Math.max(0, Math.min(imgSize.h - 1, canvasY)));
    const pixel = ctx.getImageData(ix, iy, 1, 1).data;
    const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;

    setMousePos({
      canvasX: ix,
      canvasY: iy,
      clientX,
      clientY,
      hex,
    });

    const magCanvas = magnifierCanvasRef.current;
    if (magCanvas) {
      const magCtx = magCanvas.getContext("2d");
      if (magCtx) {
        magCtx.imageSmoothingEnabled = false;
        magCtx.clearRect(0, 0, 100, 100);
        const sampleSize = 16;
        const halfSample = sampleSize / 2;
        magCtx.drawImage(
          img,
          ix - halfSample,
          iy - halfSample,
          sampleSize,
          sampleSize,
          0,
          0,
          100,
          100
        );

        // Center pixel square & crosshair
        const centerBoxSize = 100 / sampleSize;
        const centerOffset = 50 - centerBoxSize / 2;

        magCtx.strokeStyle = "rgba(56, 189, 248, 0.9)";
        magCtx.lineWidth = 1.5;
        magCtx.strokeRect(centerOffset, centerOffset, centerBoxSize, centerBoxSize);

        magCtx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        magCtx.lineWidth = 1;
        magCtx.beginPath();
        magCtx.moveTo(50, 0);
        magCtx.lineTo(50, centerOffset - 2);
        magCtx.moveTo(50, centerOffset + centerBoxSize + 2);
        magCtx.lineTo(50, 100);

        magCtx.moveTo(0, 50);
        magCtx.lineTo(centerOffset - 2, 50);
        magCtx.moveTo(centerOffset + centerBoxSize + 2, 50);
        magCtx.lineTo(100, 50);
        magCtx.stroke();
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Text input is active
      if (textInput) {
        if (e.key === "Escape") {
          setTextInput(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commitTextInput();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.code === "KeyC" || e.key.toLowerCase() === "c" || e.key === "c")) {
          e.preventDefault();
          commitTextInput();
          handleCopy();
          return;
        }
        return;
      }

      // 2. OCR modal is active
      if (ocrResultText !== null) {
        if (e.key === "Escape") {
          setOcrResultText(null);
        }
        return;
      }

      // 3. Global shortcuts
      const isCopyKey =
        e.key === "Enter" ||
        ((e.ctrlKey || e.metaKey) &&
          (e.code === "KeyC" || e.key.toLowerCase() === "c" || e.key === "c" || e.key === "\x03"));

      if (isCopyKey) {
        e.preventDefault();
        handleCopy();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (selection && selection.w < imgSize.w) {
          setSelection(null);
          setActiveTool("crop");
        } else {
          hideScreenshotOverlay();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyS" || e.key.toLowerCase() === "s")) {
        e.preventDefault();
        handleSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyZ" || e.key.toLowerCase() === "z")) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyA" || e.key.toLowerCase() === "a")) {
        e.preventDefault();
        setSelection({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
        setActiveTool("pen");
        return;
      }

      // Single-key tool switches
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "c" || e.code === "KeyC") {
          setActiveTool("crop");
          setSelection(null);
        } else if (k === "p" || e.code === "KeyP") {
          setActiveTool("pen");
        } else if (k === "h" || e.code === "KeyH") {
          setActiveTool("highlighter");
        } else if (k === "a" || e.code === "KeyA") {
          setActiveTool("arrow");
        } else if (k === "r" || e.code === "KeyR") {
          setActiveTool("rect");
        } else if (k === "t" || e.code === "KeyT") {
          setActiveTool("text");
        } else if (k === "b" || e.code === "KeyB") {
          setActiveTool("blur");
        } else if (k === "s" || e.code === "KeyS") {
          setActiveTool("step");
        } else if (k === "o" || e.code === "KeyO") {
          handleOcr();
        } else if (k === "m" || e.code === "KeyM") {
          setMockupMode((prev) => !prev);
        } else if (k === "l" || e.code === "KeyL") {
          setShowMagnifier((prev) => !prev);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [textInput, ocrResultText, annotations, selection, activeTool, color, strokeWidth, imgSize, mockupMode, showMagnifier]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imgSize.w;
    canvas.height = imgSize.h;

    // 1. Original screenshot
    ctx.drawImage(img, 0, 0, imgSize.w, imgSize.h);

    // 2. Crop selection
    const activeCrop =
      activeDrag && activeDrag.type === "crop"
        ? {
            x: Math.max(0, Math.min(activeDrag.startX, activeDrag.curX)),
            y: Math.max(0, Math.min(activeDrag.startY, activeDrag.curY)),
            w: Math.min(imgSize.w, Math.abs(activeDrag.curX - activeDrag.startX)),
            h: Math.min(imgSize.h, Math.abs(activeDrag.curY - activeDrag.startY)),
          }
        : selection;

    // 3. Dim overlay
    if (!activeCrop || activeCrop.w < 2 || activeCrop.h < 2) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, imgSize.w, imgSize.h);
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, imgSize.w, activeCrop.y);
      ctx.fillRect(0, activeCrop.y + activeCrop.h, imgSize.w, imgSize.h - (activeCrop.y + activeCrop.h));
      ctx.fillRect(0, activeCrop.y, activeCrop.x, activeCrop.h);
      ctx.fillRect(
        activeCrop.x + activeCrop.w,
        activeCrop.y,
        imgSize.w - (activeCrop.x + activeCrop.w),
        activeCrop.h
      );

      // Selection border
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(activeCrop.x, activeCrop.y, activeCrop.w, activeCrop.h);
      ctx.setLineDash([]);

      // 8 Control handles
      const handles = getSelectionHandles(activeCrop);
      const handleSize = 8;
      const halfH = handleSize / 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1.5;

      Object.values(handles).forEach((h) => {
        ctx.beginPath();
        ctx.roundRect(h.x - halfH, h.y - halfH, handleSize, handleSize, 2);
        ctx.fill();
        ctx.stroke();
      });

      // Dimension badge
      const dimText = `${Math.round(activeCrop.w)} × ${Math.round(activeCrop.h)}`;
      ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const metrics = ctx.measureText(dimText);
      const badgeW = metrics.width + 12;
      const badgeH = 20;
      const badgeY = activeCrop.y > 26 ? activeCrop.y - 24 : activeCrop.y + 6;
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.beginPath();
      ctx.roundRect(activeCrop.x, badgeY, badgeW, badgeH, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(dimText, activeCrop.x + 6, badgeY + 14);
    }

    // 4. Annotations
    const drawSingleAnnotation = (ann: Annotation) => {
      ctx.save();
      if (ann.type === "pen") {
        if (ann.points.length < 2) return;
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      } else if (ann.type === "highlighter") {
        if (ann.points.length < 2) return;
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = Math.max(14, ann.strokeWidth * 3.5);
        ctx.lineCap = "square";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      } else if (ann.type === "arrow") {
        const { startX, startY, endX, endY, color, strokeWidth } = ann;
        const dx = endX - startX;
        const dy = endY - startY;
        const angle = Math.atan2(dy, dx);
        const headLength = Math.max(14, strokeWidth * 3.5);

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - headLength * Math.cos(angle - Math.PI / 6),
          endY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          endX - headLength * Math.cos(angle + Math.PI / 6),
          endY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      } else if (ann.type === "rect") {
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.strokeWidth;
        ctx.beginPath();
        ctx.roundRect(ann.x, ann.y, ann.w, ann.h, 6);
        ctx.stroke();
      } else if (ann.type === "blur") {
        const bx = Math.round(ann.x);
        const by = Math.round(ann.y);
        const bw = Math.round(ann.w);
        const bh = Math.round(ann.h);
        if (bw > 2 && bh > 2) {
          const pixelSize = 10;
          const offCanvas = document.createElement("canvas");
          const offW = Math.max(1, Math.floor(bw / pixelSize));
          const offH = Math.max(1, Math.floor(bh / pixelSize));
          offCanvas.width = offW;
          offCanvas.height = offH;
          const offCtx = offCanvas.getContext("2d");
          if (offCtx) {
            offCtx.imageSmoothingEnabled = false;
            offCtx.drawImage(canvas, bx, by, bw, bh, 0, 0, offW, offH);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(offCanvas, 0, 0, offW, offH, bx, by, bw, bh);
            ctx.imageSmoothingEnabled = true;
          }
        }
      } else if (ann.type === "text") {
        ctx.font = `bold ${ann.fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const metrics = ctx.measureText(ann.text);
        const padding = 6;
        const textH = ann.fontSize * 1.25;
        const textW = metrics.width;

        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.beginPath();
        ctx.roundRect(ann.x - padding, ann.y - padding, textW + padding * 2, textH + padding * 2, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, ann.x, ann.y);
      } else if (ann.type === "step") {
        const radius = 14;
        ctx.fillStyle = ann.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.arc(ann.x, ann.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ann.stepNumber), ann.x, ann.y + 0.5);
      }
      ctx.restore();
    };

    annotations.forEach(drawSingleAnnotation);

    // 5. Active in-progress drag
    if (activeDrag) {
      if (activeDrag.type === "pen" || activeDrag.type === "highlighter") {
        drawSingleAnnotation({
          id: "temp",
          type: activeDrag.type,
          points: activeDrag.points,
          color,
          strokeWidth,
        });
      } else if (activeDrag.type === "arrow") {
        drawSingleAnnotation({
          id: "temp",
          type: "arrow",
          startX: activeDrag.startX,
          startY: activeDrag.startY,
          endX: activeDrag.curX,
          endY: activeDrag.curY,
          color,
          strokeWidth,
        });
      } else if (activeDrag.type === "rect") {
        const rx = Math.min(activeDrag.startX, activeDrag.curX);
        const ry = Math.min(activeDrag.startY, activeDrag.curY);
        const rw = Math.abs(activeDrag.curX - activeDrag.startX);
        const rh = Math.abs(activeDrag.curY - activeDrag.startY);
        drawSingleAnnotation({
          id: "temp",
          type: "rect",
          x: rx,
          y: ry,
          w: rw,
          h: rh,
          color,
          strokeWidth,
        });
      } else if (activeDrag.type === "blur") {
        const bx = Math.min(activeDrag.startX, activeDrag.curX);
        const by = Math.min(activeDrag.startY, activeDrag.curY);
        const bw = Math.abs(activeDrag.curX - activeDrag.startX);
        const bh = Math.abs(activeDrag.curY - activeDrag.startY);
        drawSingleAnnotation({
          id: "temp",
          type: "blur",
          x: bx,
          y: by,
          w: bw,
          h: bh,
        });
      }
    }
  }, [screenshotSrc, imgSize, selection, annotations, activeDrag, color, strokeWidth]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = imgSize.w / rect.width;
    const scaleY = imgSize.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const getCanvasCursor = () => {
    if (activeDrag?.type === "move_selection") return "move";
    if (activeDrag?.type === "resize_selection") {
      const h = activeDrag.handle;
      if (h === "nw" || h === "se") return "nwse-resize";
      if (h === "ne" || h === "sw") return "nesw-resize";
      if (h === "n" || h === "s") return "ns-resize";
      if (h === "e" || h === "w") return "ew-resize";
    }
    if (hoverHandle) {
      if (hoverHandle === "nw" || hoverHandle === "se") return "nwse-resize";
      if (hoverHandle === "ne" || hoverHandle === "sw") return "nesw-resize";
      if (hoverHandle === "n" || hoverHandle === "s") return "ns-resize";
      if (hoverHandle === "e" || hoverHandle === "w") return "ew-resize";
      if (hoverHandle === "move" && activeTool === "crop") return "move";
    }
    if (!selection || activeTool === "crop") return "crosshair";
    if (activeTool === "text") return "text";
    if (activeTool === "step") return "pointer";
    return "crosshair";
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const { x, y } = getCanvasCoords(e);

    // Hit-test resize handles or box move
    if (selection) {
      const hit = hitTestHandles(x, y, selection);
      if (hit) {
        if (hit === "move") {
          if (activeTool === "crop") {
            setActiveDrag({
              type: "move_selection",
              startX: x,
              startY: y,
              initialSel: { ...selection },
            });
            return;
          }
        } else {
          setActiveDrag({
            type: "resize_selection",
            handle: hit,
            startX: x,
            startY: y,
            initialSel: { ...selection },
          });
          return;
        }
      }
    }

    if (!selection || activeTool === "crop") {
      setActiveDrag({
        type: "crop",
        startX: x,
        startY: y,
        curX: x,
        curY: y,
      });
      return;
    }

    if (activeTool === "step") {
      setAnnotations((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          type: "step",
          x,
          y,
          stepNumber: stepCounter,
          color,
        },
      ]);
      setStepCounter((c) => c + 1);
      return;
    }

    if (activeTool === "text") {
      if (textInputRef.current && textInputRef.current.text.trim()) {
        commitTextInput();
      }
      setTextInput({ x, y, text: "" });
      return;
    }

    if (activeTool === "pen" || activeTool === "highlighter") {
      setActiveDrag({
        type: activeTool,
        points: [{ x, y }],
      });
    } else if (activeTool === "arrow" || activeTool === "rect" || activeTool === "blur") {
      setActiveDrag({
        type: activeTool,
        startX: x,
        startY: y,
        curX: x,
        curY: y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);

    // Update magnifier lens whenever showMagnifier is true and user is not in active drag
    if (showMagnifier && !activeDrag) {
      updateMagnifier(x, y, e.clientX, e.clientY);
    } else if (mousePos) {
      setMousePos(null);
    }

    // Hover handle test
    if (selection && !activeDrag) {
      const hit = hitTestHandles(x, y, selection);
      setHoverHandle(hit);
    }

    if (!activeDrag) return;

    if (activeDrag.type === "crop") {
      setActiveDrag((prev: any) => ({ ...prev, curX: x, curY: y }));
    } else if (activeDrag.type === "move_selection") {
      const dx = x - activeDrag.startX;
      const dy = y - activeDrag.startY;
      const newX = Math.max(0, Math.min(imgSize.w - activeDrag.initialSel.w, activeDrag.initialSel.x + dx));
      const newY = Math.max(0, Math.min(imgSize.h - activeDrag.initialSel.h, activeDrag.initialSel.y + dy));
      setSelection({
        ...activeDrag.initialSel,
        x: newX,
        y: newY,
      });
    } else if (activeDrag.type === "resize_selection") {
      const dx = x - activeDrag.startX;
      const dy = y - activeDrag.startY;
      const init = activeDrag.initialSel;
      let newX = init.x;
      let newY = init.y;
      let newW = init.w;
      let newH = init.h;

      const h = activeDrag.handle;
      if (h.includes("w")) {
        const maxX = init.x + init.w - 15;
        newX = Math.max(0, Math.min(maxX, init.x + dx));
        newW = init.w - (newX - init.x);
      }
      if (h.includes("e")) {
        newW = Math.max(15, Math.min(imgSize.w - init.x, init.w + dx));
      }
      if (h.includes("n")) {
        const maxY = init.y + init.h - 15;
        newY = Math.max(0, Math.min(maxY, init.y + dy));
        newH = init.h - (newY - init.y);
      }
      if (h.includes("s")) {
        newH = Math.max(15, Math.min(imgSize.h - init.y, init.h + dy));
      }

      setSelection({
        x: newX,
        y: newY,
        w: newW,
        h: newH,
      });
    } else if (activeDrag.type === "pen" || activeDrag.type === "highlighter") {
      setActiveDrag((prev: any) => ({
        ...prev,
        points: [...prev.points, { x, y }],
      }));
    } else {
      setActiveDrag((prev: any) => ({ ...prev, curX: x, curY: y }));
    }
  };

  const handleMouseLeave = () => {
    setMousePos(null);
    setHoverHandle(null);
  };

  const handleMouseUp = () => {
    if (!activeDrag) return;

    if (activeDrag.type === "move_selection" || activeDrag.type === "resize_selection") {
      setActiveDrag(null);
      return;
    }

    if (activeDrag.type === "crop") {
      const rx = Math.max(0, Math.min(activeDrag.startX, activeDrag.curX));
      const ry = Math.max(0, Math.min(activeDrag.startY, activeDrag.curY));
      const rw = Math.min(imgSize.w - rx, Math.abs(activeDrag.curX - activeDrag.startX));
      const rh = Math.min(imgSize.h - ry, Math.abs(activeDrag.curY - activeDrag.startY));

      if (rw >= 15 && rh >= 15) {
        setSelection({ x: rx, y: ry, w: rw, h: rh });
        setActiveTool("pen");
      } else {
        if (!selection || selection.w < 15 || selection.h < 15) {
          setSelection(null);
          setActiveTool("crop");
        }
      }
    } else if (activeDrag.type === "pen" || activeDrag.type === "highlighter") {
      if (activeDrag.points.length > 1) {
        setAnnotations((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            type: activeDrag.type,
            points: activeDrag.points,
            color,
            strokeWidth,
          },
        ]);
      }
    } else if (activeDrag.type === "arrow") {
      const dist = Math.hypot(
        activeDrag.curX - activeDrag.startX,
        activeDrag.curY - activeDrag.startY
      );
      if (dist > 5) {
        setAnnotations((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            type: "arrow",
            startX: activeDrag.startX,
            startY: activeDrag.startY,
            endX: activeDrag.curX,
            endY: activeDrag.curY,
            color,
            strokeWidth,
          },
        ]);
      }
    } else if (activeDrag.type === "rect") {
      const rx = Math.min(activeDrag.startX, activeDrag.curX);
      const ry = Math.min(activeDrag.startY, activeDrag.curY);
      const rw = Math.abs(activeDrag.curX - activeDrag.startX);
      const rh = Math.abs(activeDrag.curY - activeDrag.startY);
      if (rw > 5 && rh > 5) {
        setAnnotations((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            type: "rect",
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            color,
            strokeWidth,
          },
        ]);
      }
    } else if (activeDrag.type === "blur") {
      const bx = Math.min(activeDrag.startX, activeDrag.curX);
      const by = Math.min(activeDrag.startY, activeDrag.curY);
      const bw = Math.abs(activeDrag.curX - activeDrag.startX);
      const bh = Math.abs(activeDrag.curY - activeDrag.startY);
      if (bw > 5 && bh > 5) {
        setAnnotations((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            type: "blur",
            x: bx,
            y: by,
            w: bw,
            h: bh,
          },
        ]);
      }
    }

    setActiveDrag(null);
  };

  const commitTextInput = () => {
    const cur = textInputRef.current;
    if (!cur || !cur.text.trim()) {
      setTextInput(null);
      return;
    }

    setAnnotations((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        type: "text",
        x: cur.x,
        y: cur.y,
        text: cur.text.trim(),
        color,
        fontSize: Math.max(16, strokeWidth * 4.5),
      },
    ]);
    setTextInput(null);
  };

  const handleUndo = () => {
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.type === "step") {
        setStepCounter((c) => Math.max(1, c - 1));
      }
      return prev.slice(0, -1);
    });
  };

  const handleReset = () => {
    setAnnotations([]);
    setStepCounter(1);
    setTextInput(null);
  };

  const handleDoubleClick = () => {
    setSelection({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
    setActiveTool("pen");
  };

  // Export cropped region cleanly without UI selection lines, control handles, or dimension badge
  const getCroppedDataUrl = (applyMockup: boolean = mockupMode): string | null => {
    const img = imageObjRef.current;
    if (!img || imgSize.w === 0 || imgSize.h === 0) return null;

    const sel = selection || { x: 0, y: 0, w: imgSize.w, h: imgSize.h };
    const sx = Math.max(0, Math.round(sel.x));
    const sy = Math.max(0, Math.round(sel.y));
    const sw = Math.min(imgSize.w - sx, Math.round(sel.w));
    const sh = Math.min(imgSize.h - sy, Math.round(sel.h));

    if (sw <= 0 || sh <= 0) return null;

    // Helper to render clean content (screenshot + annotations) onto any context
    const renderCleanContent = (destCtx: CanvasRenderingContext2D, destX: number, destY: number) => {
      // 1. Draw source screenshot cropped to selection
      destCtx.drawImage(img, sx, sy, sw, sh, destX, destY, sw, sh);

      // 2. Draw annotations translated by (destX - sx, destY - sy)
      destCtx.save();
      destCtx.beginPath();
      destCtx.rect(destX, destY, sw, sh);
      destCtx.clip();

      destCtx.translate(destX - sx, destY - sy);

      annotations.forEach((ann) => {
        destCtx.save();
        if (ann.type === "pen") {
          if (ann.points.length < 2) return;
          destCtx.strokeStyle = ann.color;
          destCtx.lineWidth = ann.strokeWidth;
          destCtx.lineCap = "round";
          destCtx.lineJoin = "round";
          destCtx.beginPath();
          destCtx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) {
            destCtx.lineTo(ann.points[i].x, ann.points[i].y);
          }
          destCtx.stroke();
        } else if (ann.type === "highlighter") {
          if (ann.points.length < 2) return;
          destCtx.strokeStyle = ann.color;
          destCtx.lineWidth = Math.max(14, ann.strokeWidth * 3.5);
          destCtx.lineCap = "square";
          destCtx.lineJoin = "round";
          destCtx.globalAlpha = 0.35;
          destCtx.beginPath();
          destCtx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) {
            destCtx.lineTo(ann.points[i].x, ann.points[i].y);
          }
          destCtx.stroke();
        } else if (ann.type === "arrow") {
          const { startX, startY, endX, endY, color, strokeWidth } = ann;
          const dx = endX - startX;
          const dy = endY - startY;
          const angle = Math.atan2(dy, dx);
          const headLength = Math.max(14, strokeWidth * 3.5);

          destCtx.strokeStyle = color;
          destCtx.fillStyle = color;
          destCtx.lineWidth = strokeWidth;
          destCtx.lineCap = "round";

          destCtx.beginPath();
          destCtx.moveTo(startX, startY);
          destCtx.lineTo(endX, endY);
          destCtx.stroke();

          destCtx.beginPath();
          destCtx.moveTo(endX, endY);
          destCtx.lineTo(
            endX - headLength * Math.cos(angle - Math.PI / 6),
            endY - headLength * Math.sin(angle - Math.PI / 6)
          );
          destCtx.lineTo(
            endX - headLength * Math.cos(angle + Math.PI / 6),
            endY - headLength * Math.sin(angle + Math.PI / 6)
          );
          destCtx.closePath();
          destCtx.fill();
        } else if (ann.type === "rect") {
          destCtx.strokeStyle = ann.color;
          destCtx.lineWidth = ann.strokeWidth;
          destCtx.beginPath();
          destCtx.roundRect(ann.x, ann.y, ann.w, ann.h, 6);
          destCtx.stroke();
        } else if (ann.type === "blur") {
          const bx = Math.round(ann.x);
          const by = Math.round(ann.y);
          const bw = Math.round(ann.w);
          const bh = Math.round(ann.h);
          if (bw > 2 && bh > 2) {
            const pixelSize = 10;
            const offCanvas = document.createElement("canvas");
            const offW = Math.max(1, Math.floor(bw / pixelSize));
            const offH = Math.max(1, Math.floor(bh / pixelSize));
            offCanvas.width = offW;
            offCanvas.height = offH;
            const offCtx = offCanvas.getContext("2d");
            if (offCtx) {
              offCtx.imageSmoothingEnabled = false;
              offCtx.drawImage(img, bx, by, bw, bh, 0, 0, offW, offH);
              destCtx.imageSmoothingEnabled = false;
              destCtx.drawImage(offCanvas, 0, 0, offW, offH, bx, by, bw, bh);
              destCtx.imageSmoothingEnabled = true;
            }
          }
        } else if (ann.type === "text") {
          destCtx.font = `bold ${ann.fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
          destCtx.textBaseline = "top";
          destCtx.textAlign = "left";
          const metrics = destCtx.measureText(ann.text);
          const padding = 6;
          const textH = ann.fontSize * 1.25;
          const textW = metrics.width;

          destCtx.fillStyle = "rgba(15, 23, 42, 0.9)";
          destCtx.beginPath();
          destCtx.roundRect(ann.x - padding, ann.y - padding, textW + padding * 2, textH + padding * 2, 6);
          destCtx.fill();
          destCtx.strokeStyle = "rgba(255, 255, 255, 0.25)";
          destCtx.lineWidth = 1;
          destCtx.stroke();

          destCtx.fillStyle = ann.color;
          destCtx.fillText(ann.text, ann.x, ann.y);
        } else if (ann.type === "step") {
          const radius = 14;
          destCtx.fillStyle = ann.color;
          destCtx.strokeStyle = "#ffffff";
          destCtx.lineWidth = 2.5;

          destCtx.beginPath();
          destCtx.arc(ann.x, ann.y, radius, 0, Math.PI * 2);
          destCtx.fill();
          destCtx.stroke();

          destCtx.fillStyle = "#ffffff";
          destCtx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
          destCtx.textAlign = "center";
          destCtx.textBaseline = "middle";
          destCtx.fillText(String(ann.stepNumber), ann.x, ann.y + 0.5);
        }
        destCtx.restore();
      });

      destCtx.restore();
    };

    if (!applyMockup) {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = sw;
      exportCanvas.height = sh;
      const expCtx = exportCanvas.getContext("2d");
      if (!expCtx) return null;
      renderCleanContent(expCtx, 0, 0);
      return exportCanvas.toDataURL("image/png");
    }

    // Mockup Presentation Mode: Gradient background + rounded corners + soft shadow
    const pad = Math.max(36, Math.round(Math.min(sw, sh) * 0.08));
    const outW = sw + pad * 2;
    const outH = sh + pad * 2;
    const cornerRadius = 14;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = outW;
    exportCanvas.height = outH;
    const expCtx = exportCanvas.getContext("2d");
    if (!expCtx) return null;

    // 1. Sleek gradient background
    const bgGrad = expCtx.createLinearGradient(0, 0, outW, outH);
    bgGrad.addColorStop(0, "#0b132b");
    bgGrad.addColorStop(0.5, "#1c2541");
    bgGrad.addColorStop(1, "#0b132b");
    expCtx.fillStyle = bgGrad;
    expCtx.fillRect(0, 0, outW, outH);

    // 2. Drop shadow
    expCtx.save();
    expCtx.shadowColor = "rgba(0, 0, 0, 0.65)";
    expCtx.shadowBlur = 32;
    expCtx.shadowOffsetX = 0;
    expCtx.shadowOffsetY = 12;
    expCtx.beginPath();
    expCtx.roundRect(pad, pad, sw, sh, cornerRadius);
    expCtx.fillStyle = "#000000";
    expCtx.fill();
    expCtx.restore();

    // 3. Draw rounded clipped content
    expCtx.save();
    expCtx.beginPath();
    expCtx.roundRect(pad, pad, sw, sh, cornerRadius);
    expCtx.clip();
    renderCleanContent(expCtx, pad, pad);
    expCtx.restore();

    // 4. Subtle inner/border outline
    expCtx.save();
    expCtx.beginPath();
    expCtx.roundRect(pad, pad, sw, sh, cornerRadius);
    expCtx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    expCtx.lineWidth = 1.5;
    expCtx.stroke();
    expCtx.restore();

    return exportCanvas.toDataURL("image/png");
  };

  const handleCopy = async () => {
    if (isCopying) return;
    try {
      setIsCopying(true);
      // Auto-commit any active inline text input before copying
      if (textInputRef.current && textInputRef.current.text.trim()) {
        commitTextInput();
      }

      const dataUrl = getCroppedDataUrl();
      if (!dataUrl) {
        showOverlayToast("Kopyalanacak alan bulunamadı.");
        return;
      }

      await copyAnnotatedImage(dataUrl);
      // Explicitly close overlay from frontend to guarantee immediate dismissal
      await hideScreenshotOverlay();
    } catch (err) {
      showOverlayToast(`Kopyalama başarısız: ${err}`);
    } finally {
      setIsCopying(false);
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    try {
      setIsSaving(true);
      if (textInputRef.current && textInputRef.current.text.trim()) {
        commitTextInput();
      }

      const dataUrl = getCroppedDataUrl();
      if (!dataUrl) return;

      const savedPath = await saveAnnotatedImage(dataUrl);
      if (savedPath) {
        showOverlayToast("Kaydedildi!");
      }
    } catch (err) {
      showOverlayToast(`Kaydetme başarısız: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOcr = async () => {
    if (isOcrRunning) return;
    const dataUrl = getCroppedDataUrl(false);
    if (!dataUrl) {
      showOverlayToast("Lütfen önce bir alan seçin.");
      return;
    }

    try {
      setIsOcrRunning(true);
      showOverlayToast("Yazılar taranıyor (OCR)...");
      const extracted = await extractTextFromImage(dataUrl);
      if (!extracted || !extracted.trim()) {
        showOverlayToast("Görselde metin bulunamadı.");
      } else {
        setOcrResultText(extracted);
        showOverlayToast("Metin tanındı ve panoya kopyalandı!");
      }
    } catch (err: any) {
      showOverlayToast(`OCR hatası: ${err}`);
    } finally {
      setIsOcrRunning(false);
    }
  };

  // Calculate floating toolbar position
  const getToolbarStyle = (): React.CSSProperties => {
    if (!canvasRef.current || !selection) {
      return {
        top: "24px",
        left: "50%",
        transform: "translateX(-50%)",
      };
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = rect.width / imgSize.w;
    const scaleY = rect.height / imgSize.h;

    const selScreenX = rect.left + selection.x * scaleX;
    const selScreenY = rect.top + selection.y * scaleY;
    const selScreenW = selection.w * scaleX;
    const selScreenH = selection.h * scaleY;

    let top = selScreenY + selScreenH + 14;
    if (top + 60 > window.innerHeight) {
      top = Math.max(14, selScreenY - 60);
    }

    let left = selScreenX + selScreenW / 2;
    const toolbarWidth = 760;
    const minLeft = toolbarWidth / 2 + 16;
    const maxLeft = window.innerWidth - toolbarWidth / 2 - 16;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    return {
      top: `${top}px`,
      left: `${left}px`,
      transform: "translateX(-50%)",
    };
  };

  // Calculate inline text editor position
  const getTextInputStyle = (): React.CSSProperties => {
    if (!textInput || !canvasRef.current) return { display: "none" };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = rect.width / (imgSize.w || 1);
    const scaleY = rect.height / (imgSize.h || 1);
    let left = rect.left + textInput.x * scaleX;
    let top = rect.top + textInput.y * scaleY;

    if (left + 270 > window.innerWidth) {
      left = window.innerWidth - 280;
    }
    if (top + 45 > window.innerHeight) {
      top = top - 45;
    }

    return {
      left: `${Math.max(12, left)}px`,
      top: `${Math.max(12, top)}px`,
    };
  };

  return (
    <div className="screenshot-overlay-container">
      {/* Toast Notification */}
      {toastMsg && <div className="screenshot-toast">{toastMsg}</div>}

      {/* Main Canvas Viewport */}
      <canvas
        ref={canvasRef}
        className="screenshot-canvas"
        style={{
          cursor: getCanvasCursor(),
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
      />

      {/* Magnifier & Color Loupe (Active whenever showMagnifier is true and not dragging) */}
      {showMagnifier && !activeDrag && mousePos && (
        <div
          className="screenshot-magnifier"
          style={{
            left: `${Math.min(window.innerWidth - 130, Math.max(16, mousePos.clientX + 20))}px`,
            top: `${Math.min(window.innerHeight - 170, Math.max(16, mousePos.clientY + 20))}px`,
          }}
        >
          <div className="magnifier-lens">
            <canvas ref={magnifierCanvasRef} width={100} height={100} className="magnifier-canvas" />
          </div>
          <div
            className="magnifier-info"
            title="Rengi Kopyala"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(mousePos.hex);
              showOverlayToast(`Renk kopyalandı: ${mousePos.hex}`);
            }}
          >
            <div className="magnifier-color-chip" style={{ backgroundColor: mousePos.hex }} />
            <span className="magnifier-hex">{mousePos.hex}</span>
            <span className="magnifier-coords">{mousePos.canvasX},{mousePos.canvasY}</span>
          </div>
        </div>
      )}

      {/* Initial Area Selection Guidance Banner */}
      {!selection && (
        <div className="screenshot-crop-banner">
          <div className="crop-banner-info">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
              <path d="M6 2v14a2 2 0 0 0 2 2h14" />
              <path d="M18 22V8a2 2 0 0 0-2-2H2" />
            </svg>
            <span className="crop-banner-title">{t("snipDefaultBanner")}</span>
          </div>
          <div className="crop-banner-actions">
            <button
              type="button"
              className="crop-banner-btn primary"
              onClick={() => {
                setSelection({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
                setActiveTool("pen");
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
              </svg>
              <span>{t("snipFullScreen")}</span>
            </button>
            <button
              type="button"
              className="crop-banner-btn close"
              onClick={() => hideScreenshotOverlay()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
              <span>{t("cancel")} (Esc)</span>
            </button>
          </div>
        </div>
      )}

      {/* Inline Text Editor */}
      {textInput && (
        <div
          className="screenshot-text-editor"
          style={getTextInputStyle()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            className="screenshot-text-input"
            value={textInput.text}
            placeholder="Metin yazın..."
            style={{ color }}
            onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTextInput();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTextInput(null);
              }
            }}
          />
          <button
            type="button"
            className="text-editor-btn confirm"
            title="Ekle (Enter)"
            onClick={commitTextInput}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            type="button"
            className="text-editor-btn cancel"
            title="İptal (Esc)"
            onClick={() => setTextInput(null)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Floating Markup Toolbar (Only shown once an area is selected) */}
      {selection && (
        <div className="screenshot-floating-toolbar" style={getToolbarStyle()}>
          {/* Tool: Crop */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "crop" ? "active" : ""}`}
            title="Alanı Yeniden Kırp (C)"
            onClick={() => {
              setActiveTool("crop");
              setSelection(null);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2v14a2 2 0 0 0 2 2h14" />
              <path d="M18 22V8a2 2 0 0 0-2-2H2" />
            </svg>
          </button>

          <div className="toolbar-divider" />

          {/* Tool: Pen */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "pen" ? "active" : ""}`}
            title="Kalem (P)"
            onClick={() => setActiveTool("pen")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>

          {/* Tool: Highlighter */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "highlighter" ? "active" : ""}`}
            title="Vurgulayıcı (H)"
            onClick={() => setActiveTool("highlighter")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 11-6 6v3h3l6-6" />
              <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
          </button>

          {/* Tool: Arrow */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "arrow" ? "active" : ""}`}
            title="Ok İşareti (A)"
            onClick={() => setActiveTool("arrow")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>

          {/* Tool: Rectangle */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "rect" ? "active" : ""}`}
            title="Dikdörtgen (R)"
            onClick={() => setActiveTool("rect")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="18" x="3" y="3" rx="2" />
            </svg>
          </button>

          {/* Tool: Text */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "text" ? "active" : ""}`}
            title="Yazı Ekle (T)"
            onClick={() => setActiveTool("text")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" x2="15" y1="20" y2="20" />
              <line x1="12" x2="12" y1="4" y2="20" />
            </svg>
          </button>

          {/* Tool: Blur / Mosaic */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "blur" ? "active" : ""}`}
            title="Mozaik / Sansürleme (B)"
            onClick={() => setActiveTool("blur")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="7" height="7" x="3" y="3" />
              <rect width="7" height="7" x="14" y="3" />
              <rect width="7" height="7" x="14" y="14" />
              <rect width="7" height="7" x="3" y="14" />
            </svg>
          </button>

          {/* Tool: Step Badge */}
          <button
            type="button"
            className={`toolbar-btn ${activeTool === "step" ? "active" : ""}`}
            title={`Adım Numaratörü (#${stepCounter}) (S)`}
            onClick={() => setActiveTool("step")}
          >
            <span className="step-badge-icon">{stepCounter}</span>
          </button>

          <div className="toolbar-divider" />

          {/* Tool: Magnifier / Mercek Toggle */}
          <button
            type="button"
            className={`toolbar-btn ${showMagnifier ? "active" : ""}`}
            title={showMagnifier ? "Mercek / Büyüteç Açık (Kapat: L)" : "Mercek / Büyüteç Kapalı (Aç: L)"}
            onClick={() => setShowMagnifier((prev) => !prev)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          {/* Tool: OCR Metin Çıkar */}
          <button
            type="button"
            className={`toolbar-btn ${isOcrRunning ? "active" : ""}`}
            title="Ekrandan Metin Çıkar (OCR) (O)"
            disabled={isOcrRunning}
            onClick={handleOcr}
          >
            {isOcrRunning ? (
              <div className="spinner" style={{ width: 14, height: 14 }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7V4h16v3" />
                <path d="M9 20h6" />
                <path d="M12 4v16" />
              </svg>
            )}
          </button>

          {/* Tool: Mockup / Sunum Modu */}
          <button
            type="button"
            className={`toolbar-btn ${mockupMode ? "active" : ""}`}
            title={mockupMode ? "Sunum Modu Açık (Gölge & Çerçeve) (M)" : "Sunum Modu Kapalı (M)"}
            onClick={() => setMockupMode((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="14" x="3" y="5" rx="2" />
              <path d="M7 15h10" />
              <circle cx="6" cy="9" r="1" fill="currentColor" />
            </svg>
          </button>

          <div className="toolbar-divider" />

          {/* Color Palette dropdown / chips */}
          <div className="toolbar-colors">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-chip ${color === c ? "selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>

          {/* Stroke Size Chips */}
          <div className="toolbar-stroke-sizes">
            {STROKE_WIDTHS.map((s) => (
              <button
                key={s}
                type="button"
                className={`stroke-btn ${strokeWidth === s ? "active" : ""}`}
                onClick={() => setStrokeWidth(s)}
              >
                <div
                  className="stroke-circle"
                  style={{
                    width: `${Math.max(4, s * 2)}px`,
                    height: `${Math.max(4, s * 2)}px`,
                    backgroundColor: color,
                  }}
                />
              </button>
            ))}
          </div>

          <div className="toolbar-divider" />

          {/* Undo */}
          <button
            type="button"
            className="toolbar-btn"
            title="Geri Al (Ctrl+Z)"
            disabled={annotations.length === 0}
            onClick={handleUndo}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>

          {/* Reset All */}
          <button
            type="button"
            className="toolbar-btn"
            title="Tümünü Temizle"
            disabled={annotations.length === 0}
            onClick={handleReset}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>

          <div className="toolbar-divider" />

          {/* Copy to Clipboard */}
          <button
            type="button"
            className="toolbar-btn-action primary"
            title="Kopyala & Kapat (Ctrl+C / Enter)"
            onClick={handleCopy}
            disabled={isCopying}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>{isCopying ? "Kopyalanıyor..." : "Kopyala"}</span>
          </button>

          {/* Save to Disk */}
          <button
            type="button"
            className="toolbar-btn-action secondary"
            title="Farklı Kaydet (Ctrl+S)"
            onClick={handleSave}
            disabled={isSaving}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>Kaydet</span>
          </button>

          {/* Close */}
          <button
            type="button"
            className="toolbar-btn close"
            title="İptal (Esc)"
            onClick={() => hideScreenshotOverlay()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* OCR Results Modal Dialog */}
      {ocrResultText !== null && (
        <div className="ocr-modal-overlay" onClick={() => setOcrResultText(null)}>
          <div className="ocr-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="ocr-modal-header">
              <div className="ocr-modal-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
                  <path d="M4 7V4h16v3" />
                  <path d="M9 20h6" />
                  <path d="M12 4v16" />
                </svg>
                <span>{t("snipOcrTitle")}</span>
              </div>
              <button
                type="button"
                className="toolbar-btn close"
                onClick={() => setOcrResultText(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <textarea
              className="ocr-modal-textarea"
              value={ocrResultText}
              onChange={(e) => setOcrResultText(e.target.value)}
              placeholder="..."
            />
            <div className="ocr-modal-footer">
              <button
                type="button"
                className="toolbar-btn-action secondary"
                onClick={() => setOcrResultText(null)}
              >
                {t("close")}
              </button>
              <button
                type="button"
                className="toolbar-btn-action primary"
                onClick={() => {
                  navigator.clipboard.writeText(ocrResultText);
                  showOverlayToast(t("copied"));
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span>{t("snipOcrCopy")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
