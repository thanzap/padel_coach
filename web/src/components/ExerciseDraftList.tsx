export type ExerciseDraft = { title: string; description: string; target_duration_sec: string }

type Props = {
  exercises: ExerciseDraft[]
  setExercises: React.Dispatch<React.SetStateAction<ExerciseDraft[]>>
}

export function ExerciseDraftList({ exercises, setExercises }: Props) {
  return (
    <div className="stack">
      <div className="row spread">
        <h2 className="exercises-heading">Exercises (timeline order)</h2>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            setExercises((xs) => [...xs, { title: '', description: '', target_duration_sec: '' }])
          }
        >
          Add exercise
        </button>
      </div>

      {exercises.map((ex, idx) => (
        <div key={idx} className="card muted-border exercise-editor">
          <div className="row spread">
            <p className="eyebrow">#{idx + 1}</p>
            {exercises.length > 1 ? (
              <button type="button" className="ghost danger" onClick={() => setExercises((xs) => xs.filter((_, i) => i !== idx))}>
                Remove
              </button>
            ) : null}
          </div>
          <label>
            Title
            <input
              value={ex.title}
              onChange={(e) => setExercises((xs) => xs.map((v, i) => (i === idx ? { ...v, title: e.target.value } : v)))}
            />
          </label>
          <label>
            Notes
            <textarea
              rows={2}
              value={ex.description}
              onChange={(e) =>
                setExercises((xs) => xs.map((v, i) => (i === idx ? { ...v, description: e.target.value } : v)))
              }
            />
          </label>
          <label>
            Target duration (seconds, optional)
            <input
              inputMode="numeric"
              value={ex.target_duration_sec}
              placeholder="Optional"
              onChange={(e) =>
                setExercises((xs) => xs.map((v, i) => (i === idx ? { ...v, target_duration_sec: e.target.value } : v)))
              }
            />
          </label>
        </div>
      ))}
    </div>
  )
}
