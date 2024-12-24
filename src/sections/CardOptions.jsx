import { Link } from 'react-router-dom';
function CardOptions() {
    return (
        <div className="container mt-5">
            <div className="row mt-5 d-flex align-items-center">
                <div className="col">
                    <h1 className="heading-bold-2">
                      <b>  Card Options</b>
                    </h1>
                </div>
                <div className="col text-end">
                    <Link className="btn btn-primary btn-lg" to="/shop">Buy Now</Link>
                </div>
            </div>
            <div className="container">
                <div className="row mt-2">
                    {cardData.map((card, index) => (
                        <div key={index} className={`col-lg-4 mb-2 d-flex  justify-content-${card.justify}`}>
                            <div className="card-card text-center shadow-lg">
                                <img src={card.imgSrc} alt={card.imgAlt} className="imgcardoptions" />
                                <div className="mt-3">
                                    <h4><b>{card.title}</b></h4>
                                    <p className='text-white-50'>{card.description}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="row">
                    <div className="col-lg-12 " >
                        <div className="card-card-h shadow-lg" >
                            <div className="row mt-1" >
                                <div className="col-lg-12">
                            
                                    <h1><b>IntroTaps For Teams</b></h1>
                                    <p className='text-white-50'>Effortlessly manage your team's cards through our portal. Easily update and control card details, ensuring employees cannot alter their card information. Contact us for customized plans tailored to your team's needs.</p>
                                    <Link className="btn btn-primary " to="/">Get Started</Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const cardData = [
    {
        imgSrc: "/standard-card.png",
        imgAlt: "Standard Card",
        title: "Standard",
        description: "Made from stainless steel and laser-engraved, this card demands attention. Available in Black, Gold, and Silver. Gold and Silver cards are engraved in black. Black cards will be engraved showing the",
        justify: "center",
        badge: "POPULAR"
    },
    {
        imgSrc: "/img/customcard.gif",
        imgAlt: "Custom Card",
        title: "Custom",
        description: "This eco-friendly approach to networking is sure to make an impression. And we plant a tree for every card sold. Available in Birch (light) and Sapele (dark) from carefully sourced woods.",
        justify: "center"
    },
    {
        imgSrc: "/img/cardpremium.png",
        imgAlt: "Premium Card",
        title: "Premium",
        description: "The most popular option for digital business cards. Made from durable, 8 times recyclable plastic. Designed for longevity and produced with precision: the perfect choice for any occasion.",
        justify: "center"
    }
];

export default CardOptions;