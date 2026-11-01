"use client";

import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import AssetImage from "./asset-image";
import { assetLabels, type Asset } from "./asset-images";

export type PickerAsset = Pick<Asset, "id" | "category" | "storage_path" | "thumbnail_storage_path">;

export default function AssetPicker({ assets, name, label, disabled, allowEmpty = false }: {
  assets: PickerAsset[]; name: string; label: string; disabled: boolean; allowEmpty?: boolean;
}) {
  const select = useRef<HTMLSelectElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<{ path: string; url?: string }>();
  const value = assets.some((asset) => asset.id === selectedId) ? selectedId : allowEmpty ? "" : assets[0]?.id ?? "";
  const selected = assets.find((asset) => asset.id === value);
  const path = selected?.thumbnail_storage_path ?? selected?.storage_path;
  const labels = assetLabels(assets);

  useEffect(() => {
    const form = select.current?.form;
    const reset = () => setSelectedId("");
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  useEffect(() => {
    let active = true;
    if (!path || disabled) return;
    void supabase.storage.from("assets").createSignedUrl(path, 60 * 60).then(({ data, error }) => {
      if (active) setPreview({ path, url: error ? undefined : data?.signedUrl });
    }).catch(() => { if (active) setPreview({ path }); });
    return () => { active = false; };
  }, [path, disabled]);

  return <><label>{label}<select ref={select} name={name} value={value} required={!allowEmpty} disabled={disabled}
    onChange={(event) => setSelectedId(event.target.value)}>
    {allowEmpty && <option value="">이미지 없음</option>}
    {assets.map((asset) => <option key={asset.id} value={asset.id}>{labels.get(asset.id)}</option>)}
  </select></label>
    {selected && <span className="asset-picker-preview"><AssetImage
      src={!disabled && preview?.path === path ? preview?.url : undefined} alt={`${labels.get(selected.id)} 미리보기`} /></span>}
  </>;
}
