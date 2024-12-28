import Bi from '../functions/Icons';
function CustomCard() {
  const CardSection = ({ icon, title, text }) => (
    <div className="d-flex align-items-center row-prop mt-3">
      <Bi i={icon} s="display-6 p-4 iconlarge" />
      <div className="ms-4 align-self-center">
        <h1 className="heading-bold-2">{title}</h1>
        <p className="text-wrapped text-white-50" style={{ marginTop: '-15px' }}>{text}</p>
      </div>
    </div>

  );

  return (
    <div className="container mt-5 bg-light p-5" style={{ borderRadius: '50px' }}>
      <div className="row text-center">
        <h1 className="heading-bold-1">Your <b className="text-green">Style</b> Matters.</h1>
        <p className='text-muted'>Personalize your card with high-quality printing. Experience a product tailored just for you.</p>
      </div>
      <div className="row mt-3 justify-content-between">
        <div className="col">
          <div className="container mt-5">
            <div className="row">
              <div className="col">
                <CardSection 
                  icon="send-check-fill" 
                  title="Place Your Order" 
                  text="We optimize your design, print, program, pack, and deliver your card." 
                />
                <CardSection 
                  icon="pencil" 
                  title="Choose Your Design" 
                  text="Select from our designs or provide your own. We replicate it for free." 
                />
                <CardSection 
                  icon="patch-check-fill" 
                  title="Activate Your Card" 
                  text="Unpack, activate, and start using your card right away!" 
                />
              </div>
            </div>
            <button className="btn btn-lg btn-primary mt-3 ms-2">Get Started</button>

          </div>
        </div>
        <div className="col-lg-5">
          <img src="/img/customcardpost.png" className="img-small-on-mobile mt-5" alt="Custom Card" />
        </div>
      </div>
    </div>
  );
}
export default CustomCard;