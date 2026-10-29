import React, { useEffect, useMemo, useRef, useState } from "react"
import { View } from "react-native"
import { WebView } from "react-native-webview"
import { colors, radius } from "../theme"
import { buildMapHtml, scriptJson, type MapData } from "./map-html"

export type LiveMapProps = {
  data: MapData
  height: number
  onSelect?: (userId: number) => void
}

/** Leaflet map in a WebView. The page loads once; later data is pushed in without a reload. */
export default function LiveMap({ data, height, onSelect }: LiveMapProps) {
  const ref = useRef<WebView>(null)
  const [ready, setReady] = useState(false)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml(data), [])

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.__ciisUpdate && window.__ciisUpdate(${scriptJson(data)}); true;`)
  }, [ready, data])

  return (
    <View style={{ height, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <WebView
        ref={ref}
        style={{ flex: 1 }}
        originWhitelist={["*"]}
        source={{ html }}
        onLoadEnd={() => setReady(true)}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data) as { type?: string; id?: number }
            if (msg.type === "select" && typeof msg.id === "number") onSelectRef.current?.(msg.id)
          } catch {
            /* ignore */
          }
        }}
      />
    </View>
  )
}
