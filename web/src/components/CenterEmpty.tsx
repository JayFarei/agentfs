interface CenterEmptyProps {
  userName: string;
  tenant: string;
}

export function CenterEmpty({ userName, tenant }: CenterEmptyProps) {
  return (
    <div className="v01-empty">
      <div className="v01-empty__l">READY</div>
      <h2 className="v01-empty__title">
        Hello {userName.toLowerCase()} — what shall we look at?
      </h2>
      <p className="v01-empty__lede">
        Submit a question above, or pick one of the suggested chains. datafetch
        will parse the intent, match it to a chain, compile a MongoDB
        aggregation, run it against <code>{tenant}</code>, and project a typed
        result here.
      </p>
      <div className="v01-empty__steps">
        <div>
          <span className="n">1</span>
          <span>Type or pick a chain</span>
        </div>
        <div>
          <span className="n">2</span>
          <span>Watch the pipeline run</span>
        </div>
        <div>
          <span className="n">3</span>
          <span>Result projects here · cited to source</span>
        </div>
      </div>
    </div>
  );
}
