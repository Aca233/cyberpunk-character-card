import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { vehicleArtOf } from "./vehicle-art";
import styles from "./vehicles.module.css";
import type { View } from "./view";

/** 车辆页用于查看名下车辆、停车地点与异常状况。 */
export function VehiclesPage({
  view,
  onLocate,
}: {
  readonly view: View;
  readonly onLocate: (location: string) => void;
}) {
  const { vehicles, destinations } = view.travel;

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
            const location = destinations.find(
              (destination) => destination.id === vehicle.location,
            );
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
                {location && !vehicle.here && (
                  <Button
                    small
                    label={`在地图查看${vehicle.name}的停车位置`}
                    onClick={() => onLocate(location.id)}
                  >
                    地图
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
