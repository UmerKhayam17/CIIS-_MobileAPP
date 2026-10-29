import React, { useEffect, useMemo, useRef, useState } from "react"
import { View } from "react-native"
import { colors, radius } from "../theme"
import { buildMapHtml, type MapData } from "./map-html"
import type { LiveMapProps } from "./LiveMap"

type MapWindow = Window & { __ciisUpdate?: (d: MapData) => void }

/** Web build: react-native-webview has no web support, so the same map page runs in an iframe. */
export default function LiveMap({ data, height, onSelect }: LiveMapProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml(data), [])

  useEffect(() => {
    if (!ready) return
    const win = ref.current?.contentWindow as MapWindow | null | undefined
    win?.__ciisUpdate?.(JSON.parse(JSON.stringify(data)) as MapData)
  }, [ready, data])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const msg = (e.data as { payload?: { type?: string; id?: number } } | null)?.payload
      if (msg?.type === "select" && typeof msg.id === "number") onSelectRef.current?.(msg.id)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <View style={{ height, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <iframe
        ref={ref}
        title="CIIS staff map"
        srcDoc={html}
        onLoad={() => setReady(true)}
        style={{ border: 0, width: "100%", height: "100%" }}
      />
    </View>
  )
}
