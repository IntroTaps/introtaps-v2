import TypeComponent from "../components/TypeComponent";
function Section3(){
    return (
        <>
        <section className="section-3 text-center mt-5 mb-5">
          <h2 className="heading-bold-1">Sharing Made Simple.</h2>
          <p className="text-muted">Your digital business card, tailored to your preferences.
          IntroTaps offers the most comprehensive sharing options available.</p>
          <div className="container">
            <div className="row">
              <TypeComponent
                title="NFC Tag Sharing"
                description="Each of our cards is equipped with an NFC chip, allowing you to share your information with a simple tap."
                image="/typecomponent1.png"
              />
              <TypeComponent
                title="QR Code Functionality"
                description="Your card also features a QR code, providing an alternative method to share your information seamlessly."
                image="/typecomponent2.png"
              />
              <TypeComponent
                title="Shareable Link"
                description="Distribute your IntroTaps card link ubiquitously, enabling connections anytime, anywhere."
                image="/typecomponent3.png"
              />
              <TypeComponent
                title="Complimentary Stickers"
                description="Receive free QR code stickers with each card, allowing placement on your card, laptop, desk, or any preferred surface."
                image="/stickersqr.avif"
              />
            </div>
          </div>
        </section>
        </>
    );
}
export default Section3;