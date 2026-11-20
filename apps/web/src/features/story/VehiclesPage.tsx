import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { vehicleArtOf } from "./vehicle-art";
import styles from "./vehicles.module.css";
import type { View } from "./view";

/** 车辆页：展示名下车辆图片、名称、停放位置、车况与快捷打开后备箱跳转 */
export function VehiclesPage({
  view,
  onOpenStorage,
}: {
  readonly view: View;
  readonly onOpenStorage?: ((storageKey: string) => void) | undefined;
}) {
  const { vehicles } = view.travel;
  const storageByKey = new Map(view.safehouse.storage.map((g) => [g.key, g]));

  return (
    <section className={styles.page} aria-label="名下车辆">
      <header className={styles.header}>
        <h2>名下车辆</h2>
        <span>{vehicles.length} 辆</span>
      </header>
      {vehicles.length === 0 ? (
        <div className={styles.emptyBox}>
          <CellFrame />
          <p className={styles.empty}>暂无名下车辆</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {vehicles.map((vehicle) => {
            const art = vehicleArtOf(vehicle.model);
            const storageKey = `vehicle:${vehicle.id}`;
            const trunk = storageByKey.get(storageKey);
            const trunkCount = trunk ? trunk.items.reduce((sum, entry) => sum + entry.count, 0) : 0;
            const abnormal = [
              vehicle.stolen ? "赃车" : null,
              vehicle.condition === "damaged" ? "受损" : null,
              vehicle.condition === "wrecked" ? "报废" : null,
            ].filter((status): status is string => status !== null);

            const tone =
              vehicle.condition === "wrecked"
                ? "danger"
                : vehicle.condition === "damaged" || vehicle.stolen
                  ? "warn"
                  : vehicle.here
                    ? "here"
                    : "normal";

            return (
              <li className={styles.vehicle} key={vehicle.id} data-tone={tone}>
                <CellFrame />
                <span className={styles.toneRail} aria-hidden />
                <div className={styles.art}>
                  <span
                    className={styles.artGrid}
                    style={{ backgroundImage: cssUrl("fx.grid") }}
                    aria-hidden
                  />
                  {art ? (
                    <Asset id={art} alt={vehicle.name} className={styles.image} />
                  ) : (
                    <span className={styles.dim}>无图</span>
                  )}
                </div>
                <div className={styles.info}>
                  <div className={styles.titleRow}>
                    <h3>{vehicle.name}</h3>
                    {vehicle.here && <span className={styles.hereBadge}>在身边</span>}
                  </div>
                  <p className={styles.location} data-here={vehicle.here || undefined}>
                    {vehicle.location === null
                      ? "位置未知"
                      : vehicle.here
                        ? `停在当前地点 · ${vehicle.locationName}`
                        : `停在 ${vehicle.locationName}`}
                  </p>
                  {abnormal.length > 0 && (
                    <p
                      className={styles.status}
                      data-damaged={vehicle.condition === "damaged" || undefined}
                    >
                      {abnormal.join(" · ")}
                    </p>
                  )}
                </div>
                {trunk && onOpenStorage && (
                  <div className={styles.actions}>
                    <ActionButton onClick={() => onOpenStorage(storageKey)}>
                      {trunk.canTake || trunk.canStore
                        ? trunkCount > 0
                          ? `后备箱 (${trunkCount}) →`
                          : "打开后备箱 →"
                        : `查看储物 (${trunkCount}) →`}
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
