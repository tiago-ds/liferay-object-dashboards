import { useEffect, useMemo, useState } from "react";
import ClayButton from "@clayui/button";
import ClayForm, { ClaySelectWithOption } from "@clayui/form";
import ClayAlert from "@clayui/alert";
import { listObjectTargets } from "./liferay";
import {
  COUNT_MEASURE,
  dimensions,
  isCountMeasure,
  isDateField,
  measures,
} from "./classify";
import type {
  Aggregation,
  ChartConfig,
  ChartType,
  DateBucket,
  ObjectTarget,
  Strategy,
} from "./types";

interface Props {
  current: ChartConfig | null;
  onSave: (config: ChartConfig) => void;
  onCancel?: () => void;
}

const CHART_TYPES: ChartType[] = ["bar", "line", "pie", "area"];

export function ConfigPanel({ current, onSave, onCancel }: Props) {
  const [targets, setTargets] = useState<ObjectTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [erc, setErc] = useState(current?.objectErc ?? "");
  const [dimension, setDimension] = useState(current?.dimension ?? "");
  const [measure, setMeasure] = useState<string>(current?.measure ?? COUNT_MEASURE);
  const [aggregation, setAggregation] = useState<Aggregation>(current?.aggregation ?? "count");
  const [chartType, setChartType] = useState<ChartType>(current?.chartType ?? "bar");
  const [dateBucket, setDateBucket] = useState<DateBucket>(current?.dateBucket ?? "month");
  const [strategy, setStrategy] = useState<Strategy>(current?.strategy ?? "client");
  const [weightField, setWeightField] = useState<string>(current?.weightField ?? "");

  useEffect(() => {
    listObjectTargets()
      .then((t) => {
        setTargets(t);
        // Default to the first Object when starting fresh.
        if (!erc && t.length) setErc(t[0].externalReferenceCode);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load Objects."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const target = useMemo(
    () => targets?.find((t) => t.externalReferenceCode === erc) ?? null,
    [targets, erc]
  );

  const dims = target ? dimensions(target) : [];
  const meas = target ? measures(target) : [];
  // Any numeric field except the measure itself can serve as the denominator.
  const weightFields = meas.filter((m) => !isCountMeasure(m.name) && m.name !== measure);

  // When the selected Object changes, reset dependent fields to valid defaults.
  useEffect(() => {
    if (!target) return;
    if (!dims.some((d) => d.name === dimension)) {
      setDimension(dims[0]?.name ?? "");
    }
    if (!meas.some((m) => m.name === measure)) {
      setMeasure(COUNT_MEASURE);
      setAggregation("count");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erc]);

  const countSelected = isCountMeasure(measure);
  const dimensionIsDate = target ? isDateField(target, dimension) : false;

  function handleMeasureChange(value: string) {
    setMeasure(value);
    // Count ⇒ aggregation must be count; switching to a numeric measure with a
    // stale "count" ⇒ default to sum.
    if (isCountMeasure(value)) setAggregation("count");
    else if (aggregation === "count") setAggregation("sum");
  }

  function handleSave() {
    if (!target || !dimension) {
      setError("Pick an Object and a dimension first.");
      return;
    }
    if (aggregation === "wavg" && !weightField) {
      setError("A weighted average needs a weight field to divide by.");
      return;
    }
    onSave({
      objectErc: target.externalReferenceCode,
      restContextPath: target.restContextPath,
      dimension,
      measure: countSelected ? null : measure,
      aggregation: countSelected ? "count" : aggregation,
      chartType,
      dateBucket: dimensionIsDate ? dateBucket : undefined,
      weightField: aggregation === "wavg" ? weightField : undefined,
      strategy,
    });
  }

  if (error && !targets) {
    return (
      <ClayAlert displayType="danger" title="Error">
        {error}
      </ClayAlert>
    );
  }
  if (!targets) {
    return <div className="od-state">Loading Objects…</div>;
  }

  return (
    <ClayForm onSubmit={(e) => e.preventDefault()}>
      <ClayForm.Group>
        <label htmlFor="od-object">Object</label>
        <ClaySelectWithOption
          id="od-object"
          value={erc}
          onChange={(e) => setErc(e.target.value)}
          options={targets.map((t) => ({ label: t.objectName, value: t.externalReferenceCode }))}
        />
      </ClayForm.Group>

      <ClayForm.Group>
        <label htmlFor="od-dimension">Group by (dimension)</label>
        <ClaySelectWithOption
          id="od-dimension"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          options={dims.map((d) => ({ label: d.label, value: d.name }))}
        />
      </ClayForm.Group>

      {dimensionIsDate && (
        <ClayForm.Group>
          <label htmlFor="od-bucket">Date bucket</label>
          <ClaySelectWithOption
            id="od-bucket"
            value={dateBucket}
            onChange={(e) => setDateBucket(e.target.value as DateBucket)}
            options={[
              { label: "By month", value: "month" },
              { label: "By day", value: "day" },
            ]}
          />
        </ClayForm.Group>
      )}

      <ClayForm.Group>
        <label htmlFor="od-measure">Measure</label>
        <ClaySelectWithOption
          id="od-measure"
          value={measure}
          onChange={(e) => handleMeasureChange(e.target.value)}
          options={meas.map((m) => ({ label: m.label, value: m.name }))}
        />
      </ClayForm.Group>

      {!countSelected && (
        <ClayForm.Group>
          <label htmlFor="od-aggregation">Aggregation</label>
          <ClaySelectWithOption
            id="od-aggregation"
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as Aggregation)}
            options={[
              { label: "Sum", value: "sum" },
              { label: "Average", value: "avg" },
              { label: "Weighted average", value: "wavg" },
            ]}
          />
        </ClayForm.Group>
      )}

      {aggregation === "wavg" && (
        <ClayForm.Group>
          <label htmlFor="od-weight">Weight field (divide by)</label>
          <ClaySelectWithOption
            id="od-weight"
            value={weightField}
            onChange={(e) => setWeightField(e.target.value)}
            options={[
              { label: "Choose a field…", value: "" },
              ...weightFields.map((m) => ({ label: m.label, value: m.name })),
            ]}
          />
          <p className="od-help">
            Computes sum({measure}) / sum(weight) instead of averaging each group. Use this over
            pre-aggregated rows — averaging an average is wrong unless every group is the same size.
          </p>
        </ClayForm.Group>
      )}

      <ClayForm.Group>
        <label htmlFor="od-strategy">Aggregate</label>
        <ClaySelectWithOption
          id="od-strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as Strategy)}
          options={[
            { label: "In the browser", value: "client" },
            { label: "On the server", value: "server" },
          ]}
        />
        <p className="od-help">
          {strategy === "client"
            ? "Fetches one page of rows (Liferay caps it, 500 by default) and groups them here. Simple, no backend — fine for small Objects."
            : "The object-aggregator Client Extension groups the rows next to the database and returns only the points."}
        </p>
      </ClayForm.Group>

      <ClayForm.Group>
        <label htmlFor="od-chart-type">Chart type</label>
        <ClaySelectWithOption
          id="od-chart-type"
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
          options={CHART_TYPES.map((c) => ({ label: c[0].toUpperCase() + c.slice(1), value: c }))}
        />
      </ClayForm.Group>

      {error && (
        <ClayAlert displayType="warning" spritemap="">
          {error}
        </ClayAlert>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <ClayButton displayType="primary" onClick={handleSave}>
          {current ? "Update chart" : "Create chart"}
        </ClayButton>
        {onCancel && (
          <ClayButton displayType="secondary" onClick={onCancel}>
            Cancel
          </ClayButton>
        )}
      </div>
    </ClayForm>
  );
}
