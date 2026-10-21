// Wrapper names and energy-efficiency flags alone do not identify the encoder.
// Only known implementation names are used for a path hint, never the codec.
export function codecPath(sample){
  const value=sample?.implementation;
  if(!value)return {kind:'unknown',label:'未确认（浏览器未公开实现）'};
  if(/nvenc|quick\s*sync|\bqsv\b|\bamf\b|d3d1[12]videodecoder|gpuvideodecoder/i.test(value))return {kind:'hardware',label:'硬件路径（浏览器报告）'};
  if(/libvpx|openh264|libaom|dav1d|software|ffmpegvideodecoder/i.test(value))return {kind:'software',label:'软件路径（浏览器报告）'};
  return {kind:'unknown',label:'未确认（实现名称不足以判断）'};
}
