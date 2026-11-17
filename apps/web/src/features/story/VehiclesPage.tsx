import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { vehicleArtOf } from "./vehicle-art";
import styles from "./vehicles.module.css";
import type { View } from "./view";

/** 右下角装备块内的车辆页：只查看名下车辆和实际停车位置。 */
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
        <p className={styles.empty}>暂无车辆。获得车辆后，这里会显示车型图片和停车位置。</p>
      ) : (
        <div className={styles.list}>
          {vehicles.map((vehicle) => {
            const art = vehicleArtOf(vehicle.model);
            const here = vehicle.location !== null && vehicle.here;
            const location = destinations.find((d) => d.id === vehicle.location);
            const locationName = vehicle.location === null ? "位置未知" : vehicle.locationName;
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
                    <Button
                      small
                      label={`在地图查看${vehicle.name}的停车位置`}
                      disabled={!location}
                      reason={vehicle.location === null ? "车辆位置未知" : "此地点尚未标注到地图"}
                      onClick={() => {
                        if (location) onLocate(location.id);
                      }}
                    >
                      在地图查看
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
