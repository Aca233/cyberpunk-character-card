import type { AssetId } from "../../assets";

/** 车型表 id 对应原作召车界面的车辆图；不拿其他车型的图片代替。 */
const VEHICLE_ART: ReadonlyMap<string, AssetId> = new Map([
  ["makigai-maimai", "vehicleArt.makigaiMaimai"],
  ["thorton-galena", "vehicleArt.thortonGalena"],
  ["mahir-supron", "vehicleArt.mahirSupron"],
  ["villefort-cortes", "vehicleArt.villefortCortes"],
  ["chevalier-emperor", "vehicleArt.chevalierEmperor"],
  ["chevalier-thrax", "vehicleArt.chevalierThrax"],
  ["mizutani-shion", "vehicleArt.mizutaniShion"],
  ["quadra-turbo-r", "vehicleArt.quadraTurboR"],
  ["quadra-type66", "vehicleArt.quadraType66"],
  ["rayfield-caliburn", "vehicleArt.rayfieldCaliburn"],
  ["thorton-mackinaw", "vehicleArt.thortonMackinaw"],
  ["thorton-colby-pickup", "vehicleArt.thortonColbyPickup"],
  ["yaiba-kusanagi", "vehicleArt.yaibaKusanagi"],
  // 原作纳扎雷的资源内部名为 arch_nemesis。
  ["arch-nazare", "vehicleArt.archNazare"],
]);

export function vehicleArtOf(model: string | null | undefined): AssetId | undefined {
  return model ? VEHICLE_ART.get(model) : undefined;
}
