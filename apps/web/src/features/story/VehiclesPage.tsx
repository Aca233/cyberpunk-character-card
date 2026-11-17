import { useRef, useState } from "react";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { StashBody } from "./StashPanel";
import { vehicleArtOf } from "./vehicle-art";
import styles from "./vehicles.module.css";
import type { View } from "./view";

/** 车辆信息与后备箱只在右下角车辆页管理，沿用统一的选车和存取规则。 */
export function VehiclesPage({
  view,
  onLocate,
  onSelect,
  onMove,
  disabledReason,
}: {
  readonly view: View;
  readonly onLocate: (location: string) => void;
  readonly onSelect: (id: string) => Promise<void>;
  readonly onMove: (action: "store" | "take", item: string, where: string) => Promise<void>;
  readonly disabledReason?: string | undefined;
}) {
  const { vehicles, destinations } = view.travel;
  const [openedTrunk, setOpenedTrunk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const actionInFlight = useRef(false);
  const blocked = disabledReason ?? (pending ? "正在处理车辆操作，请稍候" : undefined);
  const run = async (action: () => Promise<void>) => {
    if (actionInFlight.current || disabledReason) return;
    actionInFlight.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      actionInFlight.current = false;
      setPending(false);
    }
  };
  return (
    <section className={styles.page} aria-label="名下车辆">
      <header className={styles.header}>
        <h2>名下车辆</h2>
        <span>{vehicles.length} 辆</span>
      </header>
      {vehicles.length === 0 ? (
        <p className={styles.empty}>暂无车辆。获得车辆后，这里会显示车型图片和停车位置。</p>
      ) : (
        <div className={styles.list}>
          {vehicles.map((vehicle) => {
            const art = vehicleArtOf(vehicle.model);
            const here = vehicle.location !== null && vehicle.here;
            const location = destinations.find((d) => d.id === vehicle.location);
            const locationName = vehicle.location === null ? "位置未知" : vehicle.locationName;
            const trunk = here ? view.safehouse.trunks.find((t) => t.id === vehicle.id) : undefined;
            const open = openedTrunk === vehicle.id;
            return (
              <article className={styles.vehicle} key={vehicle.id} aria-label={vehicle.name}>
                <CellFrame />
                <div className={styles.art}>
                  {art ? (
                    <Asset id={art} alt={vehicle.name} className={styles.image} />
                  ) : (
                    <span className={styles.dim}>暂无车型图片</span>
                  )}
                </div>
                <div className={styles.info}>
                  <div className={styles.tags}>
                    {vehicle.selected && <span className={styles.selected}>当前选用</span>}
                    <span data-condition={vehicle.condition}>{vehicle.conditionLabel}</span>
                    {vehicle.stolen && <span className={styles.stolen}>赃车</span>}
                  </div>
                  <h3>{vehicle.name}</h3>
                  <p className={styles.dim}>
                    {[vehicle.maker, vehicle.classLabel].filter(Boolean).join(" · ")}
                  </p>
                  <p className={styles.parking} data-here={here || undefined}>
                    <small>停车位置{here && " · 就在身边"}</small>
                    <strong>{locationName}</strong>
                  </p>
                  <div className={styles.actions}>
                    {here && !vehicle.selected && vehicle.condition !== "wrecked" && (
                      <Button
                        small
                        label={`使用${vehicle.name}`}
                        disabled={blocked !== undefined}
                        reason={blocked}
                        onClick={() => void run(() => onSelect(vehicle.id))}
                      >
                        使用这辆车
                      </Button>
                    )}
                    {trunk && (vehicle.trunk > 0 || trunk.items.length > 0) && (
                      <Button
                        small
                        label={`${open ? "收起" : "打开"}${vehicle.name}的后备箱`}
                        pressed={open}
                        onClick={() => setOpenedTrunk(open ? null : vehicle.id)}
                      >
                        {open ? "收起后备箱" : `后备箱 ${trunk.items.length}/${vehicle.trunk}`}
                      </Button>
                    )}
                    {!here && location && (
                      <Button
                        small
                        label={`在地图查看${vehicle.name}的停车位置`}
                        onClick={() => onLocate(location.id)}
                      >
                        在地图查看
                      </Button>
                    )}
                  </div>
                </div>
                {trunk && open && (
                  <div className={styles.trunk}>
                    <StashBody
                      view={view}
                      box={{
                        ...trunk,
                        cap: vehicle.trunk,
                        canStore: vehicle.condition !== "wrecked",
                      }}
                      disabledReason={blocked}
                      onMove={(action, item, where) => void run(() => onMove(action, item, where))}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
