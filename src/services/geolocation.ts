export function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("El dispositivo no tiene geolocalización disponible."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      ({ message }) => reject(new Error(message || "No fue posible obtener la ubicación.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
    );
  });
}
