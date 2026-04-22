export type VendorCameraProfile = {
  id: string;
  label: string;
  match: string[];
  rtsp: Array<{ label: string; path: string }>;
  httpStream: Array<{ label: string; path: string }>;
  snapshot: Array<{ label: string; path: string }>;
};

export const VENDOR_CAMERA_PROFILES: VendorCameraProfile[] = [
  {
    id: "hikvision",
    label: "Hikvision / HiLook / Annke ISAPI",
    match: ["hikvision", "hilook", "annke", "safire", "ezviz", "ip camera"],
    rtsp: [
      { label: "RTSP Main", path: "/Streaming/Channels/101" },
      { label: "RTSP Sub", path: "/Streaming/Channels/102" },
      { label: "RTSP Main (Slash)", path: "/Streaming/Channels/101/" },
      { label: "RTSP Sub (Slash)", path: "/Streaming/Channels/102/" }
    ],
    httpStream: [
      { label: "HTTP Sub MJPEG (ISAPI)", path: "/ISAPI/Streaming/channels/102/httpPreview" },
      { label: "HTTP Sub MJPEG", path: "/Streaming/channels/102/httpPreview" },
      { label: "HTTP Legacy MJPEG", path: "/Streaming/channels/1/httppreview" }
    ],
    snapshot: [
      { label: "Snapshot Main (ISAPI 101)", path: "/ISAPI/Streaming/channels/101/picture" },
      { label: "Snapshot Sub (ISAPI 102)", path: "/ISAPI/Streaming/channels/102/picture" },
      { label: "Snapshot Main (ISAPI 1)", path: "/ISAPI/Streaming/channels/1/picture" },
      { label: "Snapshot Main", path: "/Streaming/channels/1/picture" },
      { label: "Snapshot Main 101", path: "/Streaming/channels/101/picture" }
    ]
  },
  {
    id: "dahua",
    label: "Dahua / Amcrest",
    match: ["dahua", "amcrest", "imou"],
    rtsp: [
      { label: "RTSP Main", path: "/cam/realmonitor?channel=1&subtype=0" },
      { label: "RTSP Sub", path: "/cam/realmonitor?channel=1&subtype=1" }
    ],
    httpStream: [
      { label: "HTTP MJPEG", path: "/cgi-bin/mjpg/video.cgi?channel=1&subtype=1" },
      { label: "HTTP MJPEG Main", path: "/cgi-bin/mjpg/video.cgi?channel=1&subtype=0" }
    ],
    snapshot: [
      { label: "Snapshot", path: "/cgi-bin/snapshot.cgi?channel=1" },
      { label: "Snapshot Sub", path: "/cgi-bin/snapshot.cgi?channel=1&subtype=1" }
    ]
  },
  {
    id: "axis",
    label: "Axis",
    match: ["axis"],
    rtsp: [
      { label: "RTSP Main", path: "/axis-media/media.amp" },
      { label: "RTSP H264", path: "/axis-media/media.amp?videocodec=h264" }
    ],
    httpStream: [
      { label: "HTTP MJPEG", path: "/axis-cgi/mjpg/video.cgi" }
    ],
    snapshot: [
      { label: "Snapshot", path: "/axis-cgi/jpg/image.cgi" }
    ]
  },
  {
    id: "generic",
    label: "Generic MJPEG/JPEG",
    match: [],
    rtsp: [
      { label: "RTSP stream1", path: "/stream1" },
      { label: "RTSP stream2", path: "/stream2" },
      { label: "RTSP h264", path: "/h264" },
      { label: "RTSP live", path: "/live" }
    ],
    httpStream: [
      { label: "HTTP MJPEG", path: "/video.mjpg" },
      { label: "HTTP MJPEG CGI", path: "/mjpeg.cgi" },
      { label: "HTTP MJPEG Stream", path: "/videostream.cgi" },
      { label: "HTTP MJPEG Image", path: "/img/video.mjpeg" },
      { label: "HTTP MJPEG Folder", path: "/cgi/mjpg/mjpeg.cgi" }
    ],
    snapshot: [
      { label: "Snapshot JPG", path: "/snapshot.jpg" },
      { label: "Image JPG", path: "/image.jpg" },
      { label: "JPEG Image CGI", path: "/jpg/image.jpg" },
      { label: "Snapshot CGI", path: "/snapshot.cgi" }
    ]
  }
];

export function orderedProfiles(manufacturer?: string, model?: string): VendorCameraProfile[] {
  const haystack = `${manufacturer ?? ""} ${model ?? ""}`.toLowerCase();
  const matched = VENDOR_CAMERA_PROFILES.filter(
    (p) => p.id !== "generic" && p.match.some((m) => haystack.includes(m))
  );
  const remaining = VENDOR_CAMERA_PROFILES.filter(
    (p) => !matched.includes(p) && p.id !== "generic"
  );
  const generic = VENDOR_CAMERA_PROFILES.find((p) => p.id === "generic");
  return generic ? [...matched, ...remaining, generic] : [...matched, ...remaining];
}
