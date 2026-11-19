const supported = /^(?:image\/(?:jpeg|png|webp|gif))$/;

export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("No se pudo leer el archivo."));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

export async function prepareImage(file: File, maxDimension: number, maxBytes: number): Promise<Blob> {
  if (!file.size || file.size > 24 * 1024 * 1024) {
    throw new Error("Selecciona una imagen de hasta 24 MB.");
  }
  const inferred = /\.(jpe?g|png|webp|gif)$/i.exec(file.name)?.[1]?.toLowerCase();
  const type = file.type || (inferred && `image/${inferred === "jpg" ? "jpeg" : inferred}`);
  if (!type || !supported.test(type)) {
    throw new Error("Usa una imagen JPG, PNG, WebP o GIF. Si tu cámara guarda en HEIC, compártela como JPG.");
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo abrir esa imagen. Prueba con otra foto."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Este dispositivo no pudo preparar la foto.");
    let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    for (const quality of [0.85, 0.72, 0.6, 0.55, 0.5]) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const resized = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (resized?.type === "image/jpeg" && resized.size <= maxBytes) return resized;
      scale *= 0.8;
    }
    throw new Error("La foto no se pudo ajustar al tamaño permitido. Prueba con otra imagen.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
