/** All user-visible text, in Vietnamese. Keep labels short. */
export const vi = {
  appTitle: 'Đảo Nhiệt Đới',
  noWebGL2:
    'Trình duyệt không hỗ trợ WebGL2. Hãy dùng Chrome hoặc Edge bản mới và bật "Sử dụng tăng tốc phần cứng" trong cài đặt.',
  debug: {
    title: 'Thông số',
    fps: 'FPS',
    frameMs: 'Khung hình',
    cpu: 'CPU / khung',
    gpu: 'GPU / khung',
    drawCalls: 'Lệnh vẽ',
    triangles: 'Tam giác',
    lastPause: 'Tạm dừng khi ẩn tab',
    never: 'chưa có',
    seconds: 'giây',
    quality: 'Chất lượng',
    qualityNames: { low: 'Thấp', medium: 'Vừa', high: 'Cao' },
    msaaReload: 'Khử răng cưa đổi sau khi tải lại trang',
    lowPower: 'Tiết kiệm điện',
    autoRotate: 'Tự xoay',
    on: 'Bật',
    off: 'Tắt',
    hint: 'Kéo chuột: xoay · Cuộn: thu phóng · Chuột phải: dời',
  },
  shortcuts: {
    debug: 'Ẩn/hiện thông số',
    lowPower: 'Tiết kiệm điện',
  },
} as const;
