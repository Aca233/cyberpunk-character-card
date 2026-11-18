import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { vehicleArtOf } from "./vehicle-art";
import styles from "./vehicles.module.css";
import type { View } from "./view";

/** 车辆页只在主动展开并切到车辆页签时显示，只提供图片、名称、位置与异常状况。 */
export function VehiclesPage({ view }: { readonly view: View }) {
  const { vehicles } = view.travel;

  return (
    <section className={styles.page} aria-label="名下车辆">
      <header className={styles.header}>
        <h2>名下车辆</h2>
        <span>{vehicles.length} 辆</span>
      </header>
      {vehicles.length === 0 ? (
        <p className={styles.empty}>暂无车辆</p>
      ) : (
        <ul className={styles.list}>
          {vehicles.map((vehicle) => {
            const art = vehicleArtOf(vehicle.model);
            const abnormal = [
              vehicle.stolen ? "赃车" : null,
              vehicle.condition === "damaged" ? "受损" : null,
              vehicle.condition === "wrecked" ? "报废" : null,
            ].filter((status): status is string => status !== null);

            return (
              <li className={styles.vehicle} key={vehicle.id}>
                <CellFrame />
                <div className={styles.art}>
                  {art ? (
                    <Asset id={art} alt={vehicle.name} className={styles.image} />
                  ) : (
                    <span className={styles.dim}>无图</span>
                  )}
                </div>
                <div className={styles.info}>
                  <h3>{vehicle.name}</h3>
                  <p className={styles.location} data-here={vehicle.here || undefined}>
                    {vehicle.location === null
                      ? "位置未知"
                      : vehicle.here
                        ? `就在身边 · ${vehicle.locationName}`
                        : `停在${vehicle.locationName}`}
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
